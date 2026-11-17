import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeTestDb } from "./pgdb";
import { callNotLeadReasons, channelFromSourceName, parseCallRail } from "@/lib/callrail";
import { classify } from "@/lib/attribution";

const holder: { db: Awaited<ReturnType<typeof makeTestDb>> | null } = { db: null };
vi.mock("@/db", async () => {
  const schemaMod = await import("@/db/schema");
  return { schema: schemaMod, db: new Proxy({}, { get: (_t, p) => Reflect.get(holder.db!, p, holder.db) }) };
});

describe("CallRail parsing", () => {
  it("reads a typical post-call payload with UTMs on the landing page", () => {
    const c = parseCallRail({
      id: "CAL123", customer_name: "Pat Smith", customer_phone_number: "+13145550100", duration: "184", answered: true,
      recording_player: "https://app.callrail.com/calls/CAL123/recording", source: "Google My Business",
      landing_page_url: "https://exceptionalelectric.com/?utm_source=google&utm_medium=organic&utm_campaign=gbp&utm_content=kirkwood",
      start_time: "2026-11-17T15:04:00-06:00", first_call: "true", tracking_phone_number: "+13145550199",
    });
    expect(c.callId).toBe("CAL123");
    expect(c.durationSec).toBe(184);
    expect(c.channel).toBe("gbp");
    expect(c.touch?.utm_content).toBe("kirkwood");
    expect(c.firstCall).toBe(true);
    expect(c.startedAt?.toISOString()).toBe("2026-11-17T21:04:00.000Z");
  });

  it("Mike's GBP links (medium=organic, campaign=gbp) count as Business Profile", () => {
    expect(classify({ utm_source: "google", utm_medium: "organic", utm_campaign: "gbp", utm_content: "arnold" })).toBe("gbp");
  });

  it("uses gclid over everything, and CallRail's source label when nothing else is known", () => {
    expect(parseCallRail({ id: "1", gclid: "abc", source: "Direct" }).channel).toBe("google_ads");
    expect(parseCallRail({ id: "2", source: "Google Ads" }).channel).toBe("google_ads");
    expect(parseCallRail({ id: "3", source: "Google Organic" }).channel).toBe("organic_search");
    expect(parseCallRail({ id: "4", source: "Direct" }).channel).toBe("direct");
    expect(parseCallRail({ id: "5" }).channel).toBe("direct");
    expect(channelFromSourceName("Facebook Paid")).toBe("paid_social");
  });

  it("flags missed and short calls", () => {
    expect(callNotLeadReasons(parseCallRail({ answered: "false", duration: "0" }), 60)).toEqual(["missed call"]);
    expect(callNotLeadReasons(parseCallRail({ answered: "true", duration: "20" }), 60)[0]).toMatch(/short call/);
    expect(callNotLeadReasons(parseCallRail({ answered: "true", duration: "90" }), 60)).toEqual([]);
  });
});

describe("CallRail webhook", () => {
  beforeAll(async () => {
    holder.db = await makeTestDb();
    const [c] = await holder.db.insert(schema.clients).values({ name: "Exceptional Electric", defaultCallValueCents: 25000 }).returning();
    await holder.db.insert(schema.sites).values({ clientId: c.id, domain: "exceptionalelectric.com", siteKey: "ee1", ingestToken: "tok" });
  });
  const post = async (token: string, body: BodyInit, ct = "application/json") => {
    const { POST } = await import("@/app/api/ingest/callrail/[siteKey]/route");
    return POST(new Request(`https://metrics.test/api/ingest/callrail/ee1?token=${token}`, { method: "POST", body, headers: { "content-type": ct } }),
      { params: Promise.resolve({ siteKey: "ee1" }) });
  };

  it("rejects a bad token", async () => {
    expect((await post("nope", "{}")).status).toBe(401);
  });

  it("saves a call as a lead once, even when CallRail retries", async () => {
    const body = JSON.stringify({ id: "CALX", customer_name: "Pat", customer_phone_number: "+13145550100", duration: 125, answered: true, source: "Google Ads", keywords: "electrician near me", campaign: "Search - Electrician" });
    const r1 = await (await post("tok", body)).json();
    const r2 = await (await post("tok", body)).json();
    expect(r1.ok).toBe(true);
    expect(r2.duplicate).toBe(true);
    const rows = await holder.db!.select().from(schema.leads).where(eq(schema.leads.externalId, "CALX"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "call", source: "callrail", channel: "google_ads", status: "new", valueCents: 25000, callDurationSec: 125, adsKeyword: "electrician near me" });
  });

  it("accepts form-encoded bodies and marks missed calls as spam with no value", async () => {
    await post("tok", new URLSearchParams({ id: "CALM", answered: "false", duration: "0", source: "Direct" }).toString(), "application/x-www-form-urlencoded");
    const [row] = await holder.db!.select().from(schema.leads).where(eq(schema.leads.externalId, "CALM"));
    expect(row.status).toBe("spam");
    expect(row.spamReasons).toEqual(["missed call"]);
    expect(row.valueCents).toBeNull();
  });
});
