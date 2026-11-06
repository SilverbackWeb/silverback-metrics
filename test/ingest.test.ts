import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeTestDb } from "./pgdb";

const holder: { db: Awaited<ReturnType<typeof makeTestDb>> | null } = { db: null };
vi.mock("@/db", async () => {
  const schemaMod = await import("@/db/schema");
  return { schema: schemaMod, db: new Proxy({}, { get: (_t, p) => Reflect.get(holder.db!, p, holder.db) }) };
});

const VID = "22222222-2222-4222-8222-222222222222";
let site: typeof schema.sites.$inferSelect;

beforeAll(async () => {
  holder.db = await makeTestDb();
  const [c] = await holder.db.insert(schema.clients).values({ name: "Gateway Roofing", defaultFormValueCents: 15000 }).returning();
  [site] = await holder.db.insert(schema.sites).values({ clientId: c.id, domain: "gatewayroofingstl.com", siteKey: "gw7k2q", ingestToken: "secret-token" }).returning();
});

const beacon = (b: object, origin = "https://www.gatewayroofingstl.com") =>
  new Request("https://metrics.test/api/collect", { method: "POST", body: JSON.stringify(b), headers: { "content-type": "text/plain", origin } });

describe("collect endpoint", () => {
  it("stores attribution arrivals, skips plain pageviews, and marks the site as seen", async () => {
    const { POST } = await import("@/app/api/collect/route");
    const touch = { ts: new Date().toISOString(), landing: "https://gatewayroofingstl.com/?gclid=G1&utm_source=google&utm_medium=cpc", gclid: "G1", utm_source: "google", utm_medium: "cpc" };
    expect((await POST(beacon({ k: "gw7k2q", type: "pageview", vid: VID, touch, ft: touch }))).status).toBe(204);
    expect((await POST(beacon({ k: "gw7k2q", type: "pageview", vid: VID }))).status).toBe(204);
    expect((await POST(beacon({ k: "gw7k2q", type: "field_found", vid: VID, data: { count: 1 } }))).status).toBe(204);
    // wrong origin is ignored
    await POST(beacon({ k: "gw7k2q", type: "tel_click", vid: VID }, "https://evil.example"));

    const db = holder.db!;
    const touches = await db.select().from(schema.touches);
    expect(touches).toHaveLength(1);
    expect(touches[0].channel).toBe("google_ads");
    const [v] = await db.select().from(schema.visitors).where(eq(schema.visitors.id, VID));
    expect(v.lastTouchId).toBe(touches[0].id);
    const events = await db.select().from(schema.events);
    expect(events.map((e) => e.type).sort()).toEqual(["field_found", "pageview"]);
    const [s] = await db.select().from(schema.sites);
    expect(s.lastSeenAt).toBeTruthy();
    expect(s.lastFieldSeenAt).toBeTruthy();
  });
});

describe("Elementor webhook", () => {
  const call = async (token: string, body: Record<string, string>) => {
    const { POST } = await import("@/app/api/ingest/elementor/[siteKey]/route");
    return POST(new Request(`https://metrics.test/api/ingest/elementor/gw7k2q?token=${token}`, {
      method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded" },
    }), { params: Promise.resolve({ siteKey: "gw7k2q" }) });
  };

  it("rejects a bad token", async () => {
    expect((await call("nope", {})).status).toBe(401);
  });

  it("saves the lead with its source and the client's default value", async () => {
    const sb = JSON.stringify({ v: 1, vid: VID, ft: { referrer: "https://www.google.com/", landing: "https://gatewayroofingstl.com/" }, lt: { utm_source: "google", utm_medium: "cpc", utm_campaign: "21844", utm_term: "roof replacement", gclid: "G1", landing: "https://gatewayroofingstl.com/roof-replacement/" } });
    const res = await call("secret-token", {
      "form[name]": "Quote",
      "fields[name][id]": "name", "fields[name][type]": "text", "fields[name][title]": "Name", "fields[name][value]": "Jane Doe",
      "fields[email][id]": "email", "fields[email][type]": "email", "fields[email][title]": "Email", "fields[email][value]": "jane@example.com",
      "fields[sb_data][id]": "sb_data", "fields[sb_data][type]": "hidden", "fields[sb_data][value]": sb,
    });
    expect(res.status).toBe(200);
    const [lead] = await holder.db!.select().from(schema.leads);
    expect(lead).toMatchObject({ name: "Jane Doe", email: "jane@example.com", channel: "google_ads", firstChannel: "organic_search", utmTerm: "roof replacement", gclid: "G1", valueCents: 15000, status: "new", formName: "Quote" });
  });
});
