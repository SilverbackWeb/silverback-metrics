/**
 * DataForSEO calls used by the SEO tab. Credentials come from Worker secrets
 * DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (Silverback's own API account).
 * Parsers are pure so they can be tested against saved sample responses.
 */
import { cleanDomain } from "./util";

const API = "https://api.dataforseo.com/v3";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function hasDataForSeo() {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

export async function dfsPost(path: string, task: Json): Promise<Json> {
  const login = process.env.DATAFORSEO_LOGIN, pw = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pw) throw new Error("DataForSEO isn't connected yet (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD secrets are missing).");
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${login}:${pw}`)}`, "content-type": "application/json" },
    body: JSON.stringify([task]),
  });
  if (!res.ok) throw new Error(`DataForSEO ${path}: HTTP ${res.status}`);
  const body = (await res.json()) as Json;
  const t = body.tasks?.[0];
  if (!t || t.status_code !== 20000) throw new Error(`DataForSEO ${path}: ${t?.status_message ?? body.status_message ?? "no task"}`);
  return t.result?.[0] ?? {};
}

const sameSite = (domain: string | undefined | null, mine: string) => {
  if (!domain) return false;
  const d = cleanDomain(domain);
  return d === mine || d.endsWith(`.${mine}`);
};

/** Position of the client's site in Google's regular results (null if not in the results checked). */
export function findOrganic(result: Json, domain: string): { position: number | null; url: string | null } {
  const mine = cleanDomain(domain);
  for (const it of result.items ?? []) {
    if (it.type === "organic" && sameSite(it.domain ?? it.url, mine)) return { position: it.rank_group ?? null, url: it.url ?? null };
  }
  return { position: null, url: null };
}

/** Position of the client's Business Profile in Google Maps results, matched by website or business name. */
export type MapsHit = { position: number | null; url: string | null; place?: { lat: number; lng: number; cid: string | null; title: string | null } };

export function findMaps(result: Json, domain: string, name: string | null, cid?: string | null): MapsHit {
  const mine = cleanDomain(domain);
  const n = name?.trim().toLowerCase();
  for (const it of result.items ?? []) {
    if (!String(it.type ?? "").startsWith("maps")) continue;
    const byCid = cid ? String(it.cid ?? "") === cid : false;
    const byDomain = sameSite(it.domain ?? it.url, mine);
    const byName = n ? String(it.title ?? "").toLowerCase().includes(n) : false;
    if (byCid || byDomain || byName) {
      const place = typeof it.latitude === "number" && typeof it.longitude === "number"
        ? { lat: it.latitude, lng: it.longitude, cid: it.cid ? String(it.cid) : null, title: it.title ?? null } : undefined;
      return { position: it.rank_group ?? null, url: it.title ?? null, place };
    }
  }
  return { position: null, url: null };
}

export type RankedKeyword = { keyword: string; position: number; url: string | null; searchVolume: number | null; etv: number | null };

/** Every keyword where the site ranks in Google's top 100 (DataForSEO Labs, US data). */
export function parseRanked(result: Json): RankedKeyword[] {
  const out: RankedKeyword[] = [];
  for (const it of result.items ?? []) {
    const kw = it.keyword_data?.keyword;
    const serp = it.ranked_serp_element?.serp_item;
    const pos = serp?.rank_group;
    if (!kw || typeof pos !== "number") continue;
    out.push({ keyword: kw, position: pos, url: serp?.url ?? null, searchVolume: it.keyword_data?.keyword_info?.search_volume ?? null, etv: serp?.etv ?? null });
  }
  // One row per keyword (a site can rank twice for the same keyword): keep the best spot.
  const best = new Map<string, RankedKeyword>();
  for (const r of out) if (!best.has(r.keyword) || best.get(r.keyword)!.position > r.position) best.set(r.keyword, r);
  return [...best.values()];
}

export const ORGANIC_DEPTH = 30;
export const MAPS_DEPTH = 20;

export function organicTask(keyword: string, location: string) {
  return { keyword, location_name: location, language_code: "en", device: "desktop", depth: ORGANIC_DEPTH };
}
export function mapsTask(keyword: string, location: string) {
  return { keyword, location_name: location, language_code: "en", depth: MAPS_DEPTH };
}
export function rankedTask(domain: string) {
  return {
    target: cleanDomain(domain), location_name: "United States", language_code: "en", limit: 1000,
    filters: [["ranked_serp_element.serp_item.rank_group", "<=", 100]],
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  };
}
