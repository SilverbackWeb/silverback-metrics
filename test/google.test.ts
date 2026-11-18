import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeTestDb } from "./pgdb";

process.env.AUTH_SECRET = "test-secret-at-least-16";
const holder: { db: Awaited<ReturnType<typeof makeTestDb>> | null; token: string | null } = { db: null, token: null };
vi.mock("@/db", async () => ({ schema: await import("@/db/schema"), db: new Proxy({}, { get: (_t, p) => Reflect.get(holder.db!, p, holder.db) }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sbm_session" && holder.token ? { value: holder.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ host: "metrics.test" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

describe("Google helpers", () => {
  it("encrypts the refresh token and reads it back", async () => {
    const { encrypt, decrypt } = await import("@/lib/google");
    const enc = await encrypt("1//refresh-token");
    expect(enc).not.toContain("refresh");
    expect(await decrypt(enc)).toBe("1//refresh-token");
  });
  it("converts Google's account-local times to UTC", async () => {
    const { zonedToUtc } = await import("@/lib/google-sync");
    expect(zonedToUtc("2026-11-17 10:20:00", "America/Chicago")?.toISOString()).toBe("2026-11-17T16:20:00.000Z");
    expect(zonedToUtc("2026-07-01 10:00:00", "America/Chicago")?.toISOString()).toBe("2026-07-01T15:00:00.000Z");
  });
});

describe("Google sync", () => {
  let clientId = "", agencyId = "";
  beforeAll(async () => {
    const db = (holder.db = await makeTestDb());
    const [a] = await db.insert(schema.users).values({ email: "team@silverbackweb.com", name: "Team", isAgency: true, agencyRole: "agency_admin" }).returning();
    agencyId = a.id;
    const [c] = await db.insert(schema.clients).values({ name: "Exceptional Electric", defaultCallValueCents: 25000 }).returning();
    clientId = c.id;
    await db.insert(schema.sites).values({ clientId, domain: "exceptionalelectric.com", siteKey: "ee1", ingestToken: "tok" });
    Object.assign(process.env, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_ADS_DEVELOPER_TOKEN: "dev", GOOGLE_ADS_LOGIN_CUSTOMER_ID: "111-222-3333" });
    const { saveConnection } = await import("@/lib/google");
    await saveConnection({ refreshToken: "rt", email: "team@silverbackweb.com", scope: "x" });
    await db.insert(schema.integrations).values([{ clientId, kind: "google_ads", externalId: "1234567890" }, { clientId, kind: "gsc", externalId: "sc-domain:exceptionalelectric.com" }]);
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = init?.body ? String(init.body) : "";
      const json = (j: object) => new Response(JSON.stringify(j));
      if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "at", expires_in: 3600 });
      if (url.includes("googleAds:search")) {
        const q = JSON.parse(body).query as string;
        if (q.includes("customer_client")) return json({ results: [{ customerClient: { id: "1234567890", descriptiveName: "Exceptional Electric", manager: false, status: "ENABLED" } }] });
        if (q.includes("local_services_lead")) return json({ results: [
          { localServicesLead: { resourceName: "customers/1234567890/localServicesLeads/9", leadType: "PHONE_CALL", leadStatus: "ACTIVE", creationDateTime: "2026-11-17 10:20:00", leadCharged: true, contactDetails: { consumerName: "Sam", phoneNumber: "+13145551234" } } },
          { localServicesLead: { resourceName: "customers/1234567890/localServicesLeads/10", leadType: "MESSAGE", leadStatus: "DECLINED", creationDateTime: "2026-11-16 09:00:00" } },
        ] });
        return json({ results: [
          { segments: { date: "2026-11-16" }, campaign: { id: "21844", name: "Search - Electrician", advertisingChannelType: "SEARCH" }, metrics: { impressions: "900", clicks: "41", costMicros: "123450000", conversions: 3 } },
          { segments: { date: "2026-11-16" }, campaign: { id: "555", name: "LSA", advertisingChannelType: "LOCAL_SERVICES" }, metrics: { impressions: "10", clicks: "0", costMicros: "45000000", conversions: 0 } },
        ] });
      }
      if (url.endsWith("/webmasters/v3/sites")) return json({ siteEntry: [{ siteUrl: "sc-domain:exceptionalelectric.com", permissionLevel: "siteOwner" }] });
      if (url.includes("searchAnalytics")) {
        const dims = JSON.parse(body).dimensions[0];
        if (dims === "date") return json({ rows: [{ keys: ["2026-11-14"], clicks: 20, impressions: 400, position: 8.2 }, { keys: ["2026-11-15"], clicks: 22, impressions: 410, position: 8.0 }] });
        return json({ rows: [{ keys: [dims === "query" ? "electrician kirkwood" : "https://exceptionalelectric.com/"], clicks: 12, impressions: 200, position: 3.1 }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  it("pulls ad spend, Local Services leads and Search Console data, once per lead", async () => {
    const { googleHourly, syncClient } = await import("@/lib/google-sync");
    expect(await googleHourly()).toEqual([clientId]);
    await syncClient(clientId); // second run must not duplicate leads
    const db = holder.db!;
    const ads = await db.select().from(schema.adsDaily);
    expect(ads.map((a) => [a.campaignId, a.costMicros, a.channelType]).sort()).toEqual([["21844", 123450000, "SEARCH"], ["555", 45000000, "LOCAL_SERVICES"]]);
    const lsa = await db.select().from(schema.leads).where(eq(schema.leads.source, "lsa"));
    expect(lsa).toHaveLength(2);
    const call = lsa.find((l) => l.type === "call")!;
    expect(call).toMatchObject({ channel: "local_services", name: "Sam", status: "new", valueCents: 25000 });
    expect(call.createdAt.toISOString()).toBe("2026-11-17T16:20:00.000Z");
    expect(lsa.find((l) => l.type === "chat")!.status).toBe("spam");
    expect((await db.select().from(schema.gscDaily)).length).toBe(2);
    expect((await db.select().from(schema.gscTop)).length).toBe(2);
    const ints = await db.select().from(schema.integrations);
    expect(ints.every((i) => i.lastSyncAt && !i.lastSyncError)).toBe(true);
    expect(await googleHourly()).toEqual([]); // not due again yet
  });

  it("Setup shows the account pickers once Google is connected", async () => {
    const { signSession } = await import("@/lib/session");
    holder.token = await signSession({ userId: agencyId, name: "Team", agency: true });
    const { default: Setup } = await import("@/app/c/[clientId]/setup/page");
    const html = renderToString(await Setup({ params: Promise.resolve({ clientId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("connected as team@silverbackweb.com");
    expect(html.replace(/<!-- -->/g, "")).toContain("Exceptional Electric · 123-456-7890");
    expect(html).toContain("sc-domain:exceptionalelectric.com");
    expect(html).toContain("syncs every night");
  });
});
