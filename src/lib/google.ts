/**
 * Silverback's single Google connection. The team signs in once with the agency Google account
 * (the one that manages the Ads MCC and has access to each client's Search Console). The refresh
 * token is stored encrypted; each sync swaps it for a short-lived access token.
 *
 * Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN,
 * GOOGLE_ADS_LOGIN_CUSTOMER_ID (the MCC, digits only), optional GOOGLE_ADS_API_VERSION.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
// Google retires Ads API versions about a year after release. Try the configured one, then recent ones,
// and remember whichever answers, so a retired default doesn't break the sync.
const VERSIONS = ["v24", "v23", "v22", "v21"];
let workingVersion: string | null = null;
export const adsVersion = () => workingVersion ?? process.env.GOOGLE_ADS_API_VERSION ?? VERSIONS[0];
export const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// ---- refresh token encryption (AES-GCM, key derived from AUTH_SECRET) ----
async function key() {
  const raw = new TextEncoder().encode(`${process.env.AUTH_SECRET ?? ""}|google-token`);
  const hash = await crypto.subtle.digest("SHA-256", raw);
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function encrypt(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function decrypt(enc: string) {
  const [iv, ct] = enc.split(".").map(unb64);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> }, await key(), ct as Uint8Array<ArrayBuffer>));
}

// ---- OAuth ----
export function authUrl(redirectUri: string, state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: redirectUri, response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const j = await res.json() as { refresh_token?: string; id_token?: string; scope?: string; error_description?: string };
  if (!res.ok || !j.refresh_token) throw new Error(j.error_description ?? "Google didn't return a refresh token");
  let email: string | null = null;
  try { email = JSON.parse(atob(j.id_token!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email ?? null; } catch { /* no id token */ }
  return { refreshToken: j.refresh_token, email, scope: j.scope ?? "" };
}

export async function saveConnection(c: { refreshToken: string; email: string | null; scope: string }) {
  const row = { id: "agency", email: c.email, refreshTokenEnc: await encrypt(c.refreshToken), scopes: c.scope, connectedAt: new Date() };
  await db.insert(schema.googleAuth).values(row).onConflictDoUpdate({ target: schema.googleAuth.id, set: row });
}

export async function connection() {
  const [row] = await db.select().from(schema.googleAuth).where(eq(schema.googleAuth.id, "agency")).limit(1);
  return row ?? null;
}

let cached: { token: string; exp: number } | null = null;
export async function accessToken() {
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const conn = await connection();
  if (!conn) throw new Error("Google isn't connected yet.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: await decrypt(conn.refreshTokenEnc), client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", grant_type: "refresh_token" }),
  });
  const j = await res.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(j.error === "invalid_grant" ? "Google sign-in expired. Reconnect Google on the Setup tab." : `Google token: ${j.error_description ?? j.error ?? res.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

// ---- Google Ads (GAQL) ----
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function adsSearch(version: string, customerId: string, body: object) {
  return fetch(`https://googleads.googleapis.com/${version}/customers/${digits(customerId)}/googleAds:search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await accessToken()}`, "content-type": "application/json",
      ...(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? { "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
      ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { "login-customer-id": digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) } : {}),
    },
    body: JSON.stringify(body),
  });
}

export async function gaql(customerId: string, query: string, maxPages = 5): Promise<Row[]> {
  const out: Row[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const body = { query, ...(pageToken ? { pageToken } : {}) };
    let res: Response | null = null;
    const tries = workingVersion ? [workingVersion] : [...new Set([process.env.GOOGLE_ADS_API_VERSION, ...VERSIONS].filter(Boolean) as string[])];
    for (const v of tries) {
      res = await adsSearch(v, customerId, body);
      if (res.status !== 404) { workingVersion = v; break; } // 404 = this API version is retired or not out yet
    }
    const j = await res!.json().catch(() => ({})) as { results?: Row[]; nextPageToken?: string; error?: { message?: string; details?: { errors?: { message?: string }[] }[] } };
    if (!res!.ok) throw new Error(`Google Ads: ${j.error?.details?.[0]?.errors?.[0]?.message ?? j.error?.message ?? res!.status}`);
    out.push(...(j.results ?? []));
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

/** Ads accounts under the MCC, for the Setup tab picker. */
export async function listAdsAccounts() {
  const mcc = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (!mcc) return [];
  const rows = await gaql(mcc, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level <= 1", 2);
  return rows.map((r) => r.customerClient).filter((c) => c && !c.manager && c.status !== "CANCELED")
    .map((c) => ({ id: String(c.id), name: c.descriptiveName ?? String(c.id) })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Search Console ----
export async function gsc(path: string, body?: object) {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json() as Row;
  if (!res.ok) throw new Error(`Search Console: ${j.error?.message ?? res.status}`);
  return j;
}

export async function listGscSites(): Promise<string[]> {
  const j = await gsc("sites");
  return ((j.siteEntry ?? []) as { siteUrl: string; permissionLevel: string }[])
    .filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl).sort();
}
