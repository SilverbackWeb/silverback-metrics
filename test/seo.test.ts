import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeTestDb } from "./pgdb";
import { findMaps, findOrganic, parseRanked } from "@/lib/dataforseo";

process.env.AUTH_SECRET = "test-secret-at-least-16";
const holder: { db: Awaited<ReturnType<typeof makeTestDb>> | null; token: string | null } = { db: null, token: null };
vi.mock("@/db", async () => ({ schema: await import("@/db/schema"), db: new Proxy({}, { get: (_t, p) => Reflect.get(holder.db!, p, holder.db) }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sbm_session" && holder.token ? { value: holder.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ host: "metrics.test" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const organic = { items: [
  { type: "local_pack", rank_group: 1, domain: "exceptionalelectric.com", title: "Exceptional Electric" },
  { type: "organic", rank_group: 1, domain: "www.angi.com", url: "https://www.angi.com/x" },
  { type: "organic", rank_group: 2, domain: "www.exceptionalelectric.com", url: "https://www.exceptionalelectric.com/kirkwood/" },
] };
const maps = { items: [
  { type: "maps_search", rank_group: 1, title: "Sparky's", domain: "sparkys.com" },
  { type: "maps_search", rank_group: 2, title: "Exceptional Electric LLC", domain: null },
] };
const ranked = { items: [
  { keyword_data: { keyword: "electrician kirkwood", keyword_info: { search_volume: 390 } }, ranked_serp_element: { serp_item: { rank_group: 3, url: "https://exceptionalelectric.com/", etv: 40 } } },
  { keyword_data: { keyword: "electrician kirkwood", keyword_info: { search_volume: 390 } }, ranked_serp_element: { serp_item: { rank_group: 9, url: "https://exceptionalelectric.com/kirkwood/" } } },
  { keyword_data: { keyword: "panel upgrade", keyword_info: { search_volume: 90 } }, ranked_serp_element: { serp_item: { rank_group: 14, url: "https://exceptionalelectric.com/panels/" } } },
] };

describe("DataForSEO parsing", () => {
  it("finds the site in regular results, skipping the map pack", () => {
    expect(findOrganic(organic, "exceptionalelectric.com")).toEqual({ position: 2, url: "https://www.exceptionalelectric.com/kirkwood/" });
    expect(findOrganic(organic, "nope.com").position).toBeNull();
  });
  it("finds the Maps listing by business name when it has no website", () => {
    expect(findMaps(maps, "exceptionalelectric.com", "Exceptional Electric").position).toBe(2);
    expect(findMaps(maps, "exceptionalelectric.com", null).position).toBeNull();
  });
  it("keeps the best position per keyword", () => {
    const r = parseRanked(ranked);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.keyword === "electrician kirkwood")?.position).toBe(3);
  });
});

describe("rank check and SEO page", () => {
  let clientId = "", agencyId = "", ownerId = "";
  beforeAll(async () => {
    const db = (holder.db = await makeTestDb());
    const [a] = await db.insert(schema.users).values({ email: "team@silverbackweb.com", name: "Team", isAgency: true, agencyRole: "agency_admin" }).returning();
    const [o] = await db.insert(schema.users).values({ email: "owner@ee.com", name: "Owner" }).returning();
    const [c] = await db.insert(schema.clients).values({ name: "Exceptional Electric", rankLocations: ["Kirkwood,Missouri,United States"], gbpName: "Exceptional Electric" }).returning();
    agencyId = a.id; ownerId = o.id; clientId = c.id;
    await db.insert(schema.memberships).values({ userId: o.id, clientId: c.id, role: "client_owner" });
    await db.insert(schema.sites).values({ clientId: c.id, domain: "exceptionalelectric.com", siteKey: "ee1", ingestToken: "tok" });
    await db.insert(schema.rankKeywords).values({ clientId: c.id, keyword: "electrician kirkwood" });
    process.env.DATAFORSEO_LOGIN = "l"; process.env.DATAFORSEO_PASSWORD = "p";
    vi.stubGlobal("fetch", async (url: string) => {
      const result = url.includes("organic") ? organic : url.includes("maps") ? maps : ranked;
      return new Response(JSON.stringify({ tasks: [{ status_code: 20000, result: [result] }] }));
    });
  });

  it("the hourly job checks a due client and saves positions and the page-1 snapshot", async () => {
    const { seoHourly } = await import("@/lib/seo");
    const r = await seoHourly();
    expect(r.rankCheck).toBe(clientId);
    const rows = await holder.db!.select().from(schema.rankResults);
    expect(rows.map((x) => [x.engine, x.position]).sort()).toEqual([["maps", 2], ["organic", 2]]);
    const snap = await holder.db!.select().from(schema.rankedKeywords).where(eq(schema.rankedKeywords.clientId, clientId));
    expect(snap).toHaveLength(2);
    expect((await seoHourly()).rankCheck).toBeNull(); // not due again for a week
  });

  it("renders for the team (with editing) and for the client (read only)", async () => {
    const { signSession } = await import("@/lib/session");
    const { default: Seo } = await import("@/app/c/[clientId]/seo/page");
    const p = { params: Promise.resolve({ clientId }), searchParams: Promise.resolve({}) };
    holder.token = await signSession({ userId: agencyId, name: "Team", agency: true });
    const team = renderToString(await Seo(p));
    expect(team).toContain("electrician kirkwood");
    expect(team).toContain("#2");
    expect(team).toContain("Add keywords");
    expect(team).toContain("On page 1 of Google");
    holder.token = await signSession({ userId: ownerId, name: "Owner", agency: false });
    const client = renderToString(await Seo(p));
    expect(client).toContain("electrician kirkwood");
    expect(client).not.toContain("Add keywords");
    expect(client).not.toContain("Ranking settings");
  });
});
