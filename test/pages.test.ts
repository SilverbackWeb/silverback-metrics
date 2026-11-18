/** Smoke-render the dashboard pages against a real (in-memory) Postgres, as agency and client users. */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import * as schema from "@/db/schema";
import { makeTestDb } from "./pgdb";

process.env.AUTH_SECRET = "test-secret-at-least-16";
const holder: { db: Awaited<ReturnType<typeof makeTestDb>> | null; token: string | null } = { db: null, token: null };
vi.mock("@/db", async () => ({ schema: await import("@/db/schema"), db: new Proxy({}, { get: (_t, p) => Reflect.get(holder.db!, p, holder.db) }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sbm_session" && holder.token ? { value: holder.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ host: "metrics.test" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let gateway: string, other: string, leadId: string, agencyId: string, ownerId: string;

beforeAll(async () => {
  const db = (holder.db = await makeTestDb());
  const [a] = await db.insert(schema.users).values({ email: "mike@silverbackweb.com", name: "Mike", isAgency: true, agencyRole: "agency_admin" }).returning();
  const [o] = await db.insert(schema.users).values({ email: "owner@gateway.com", name: "Dana Keller" }).returning();
  agencyId = a.id; ownerId = o.id;
  const [c1] = await db.insert(schema.clients).values({ name: "Gateway Roofing", website: "https://gatewayroofingstl.com" }).returning();
  const [c2] = await db.insert(schema.clients).values({ name: "Other Client" }).returning();
  gateway = c1.id; other = c2.id;
  await db.insert(schema.memberships).values({ userId: o.id, clientId: c1.id, role: "client_owner" });
  await db.insert(schema.sites).values({ clientId: c1.id, domain: "gatewayroofingstl.com", siteKey: "gw7k2q", ingestToken: "tok", lastSeenAt: new Date() });
  const now = new Date();
  const [l] = await db.insert(schema.leads).values([
    { clientId: c1.id, type: "form", source: "elementor", channel: "google_ads", name: "Jane Doe", createdAt: now, valueCents: 15000, utmCampaign: "21844",
      lastTouch: { utm_source: "google", utm_medium: "cpc", gclid: "G1", landing: "https://gatewayroofingstl.com/roof-replacement/" }, landingPage: "https://gatewayroofingstl.com/roof-replacement/" },
    { clientId: c1.id, type: "call", source: "callrail", channel: "gbp", name: "Bob Smith", createdAt: now, status: "won", saleCents: 1400000, callDurationSec: 185 },
  ]).returning();
  leadId = l.id;
});

async function as(userId: string, name: string, agency: boolean) {
  const { signSession } = await import("@/lib/session");
  holder.token = await signSession({ userId, name, agency });
}
const render = async (el: Promise<React.ReactElement>) => renderToString(await el);

describe("pages as the Silverback team", () => {
  it("home lists every client with tracking health", async () => {
    await as(agencyId, "Mike", true);
    const { default: Home } = await import("@/app/page");
    const html = await render(Home());
    expect(html).toContain("Gateway Roofing");
    expect(html).toContain("Other Client");
    expect(html).toContain("No site added");
  });
  it("overview, leads, lead and setup render", async () => {
    await as(agencyId, "Mike", true);
    const p = { params: Promise.resolve({ clientId: gateway }), searchParams: Promise.resolve({}) };
    const ov = await render((await import("@/app/c/[clientId]/page")).default(p));
    expect(ov).toContain("Where leads came from");
    expect(ov).toContain("$14,000");
    const ls = await render((await import("@/app/c/[clientId]/leads/page")).default(p));
    expect(ls).toContain("Jane Doe");
    expect(ls).toContain("Call · 3m 5s");
    const ld = await render((await import("@/app/c/[clientId]/leads/[leadId]/page")).default({ params: Promise.resolve({ clientId: gateway, leadId }) }));
    expect(ld).toContain("Arrived · Google Ads");
    expect(ld).toContain("Sale amount");
    const st = await render((await import("@/app/c/[clientId]/setup/page")).default(p));
    expect(st).toContain("/api/ingest/elementor/gw7k2q?token=tok");
    expect(st).toContain("Dana Keller");
  });
});

describe("pages as a client owner", () => {
  it("goes straight to their own dashboard and cannot open another client", async () => {
    await as(ownerId, "Dana Keller", false);
    const { default: Home } = await import("@/app/page");
    await expect(render(Home())).rejects.toThrow(`REDIRECT /c/${gateway}`);
    const p = (id: string) => ({ params: Promise.resolve({ clientId: id }), searchParams: Promise.resolve({}) });
    await expect(render((await import("@/app/c/[clientId]/page")).default(p(other)))).rejects.toThrow("NOT_FOUND");
    await expect(render((await import("@/app/c/[clientId]/setup/page")).default(p(gateway)))).rejects.toThrow("NOT_FOUND");
    const ld = await render((await import("@/app/c/[clientId]/leads/[leadId]/page")).default({ params: Promise.resolve({ clientId: gateway, leadId }) }));
    expect(ld).toContain('name="sale"');
    expect(ld).not.toContain("Setup");
  });
  it("cannot open a lead through another client's URL", async () => {
    await as(agencyId, "Mike", true);
    await expect(render((await import("@/app/c/[clientId]/leads/[leadId]/page")).default({ params: Promise.resolve({ clientId: other, leadId }) }))).rejects.toThrow("NOT_FOUND");
  });
});

describe("editing a lead", () => {
  it("client owner sets a sale amount; status becomes won and both changes are logged", async () => {
    await as(ownerId, "Dana Keller", false);
    const { updateLead } = await import("@/app/c/[clientId]/leads/[leadId]/actions");
    const f = new FormData(); f.set("value", "150"); f.set("sale", "$18,500");
    await expect(updateLead(gateway, leadId, f)).rejects.toThrow("REDIRECT");
    const { eq } = await import("drizzle-orm");
    const [l] = await holder.db!.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    expect(l).toMatchObject({ status: "won", saleCents: 1850000, valueCents: 15000 });
    const log = await holder.db!.select().from(schema.leadEdits).where(eq(schema.leadEdits.leadId, leadId));
    expect(log.map((e) => [e.field, e.newValue, e.userName]).sort()).toEqual([["sale", "$18,500", "Dana Keller"], ["status", "won", "Dana Keller"]]);
  });
  it("a viewer cannot edit", async () => {
    const db = holder.db!;
    const [v] = await db.insert(schema.users).values({ email: "viewer@gateway.com", name: "Viewer" }).returning();
    await db.insert(schema.memberships).values({ userId: v.id, clientId: gateway, role: "client_viewer" });
    await as(v.id, "Viewer", false);
    const { updateLead } = await import("@/app/c/[clientId]/leads/[leadId]/actions");
    const f = new FormData(); f.set("status", "spam");
    await expect(updateLead(gateway, leadId, f)).rejects.toThrow("NOT_FOUND");
  });
});
