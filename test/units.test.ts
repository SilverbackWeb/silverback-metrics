import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, tempPassword } from "@/lib/password";
import { permissions } from "@/lib/access";
import { byChannel, byWeek, monthRange, summarize, topLandingPages, type ReportLead } from "@/lib/reports";
import { journeySteps } from "@/lib/journey";
import { parseDollars, cleanDomain } from "@/lib/util";

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(tempPassword()).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
  });
});

describe("permissions", () => {
  const client = { clientsCanEditLeads: true };
  it("agency sees and edits everything", () => {
    expect(permissions({ isAgency: true, agencyRole: "agency_staff" }, null, client)).toMatchObject({ view: true, editLeads: true, admin: false });
  });
  it("client owner can edit, viewer cannot, stranger sees nothing", () => {
    expect(permissions({ isAgency: false, agencyRole: null }, "client_owner", client).editLeads).toBe(true);
    expect(permissions({ isAgency: false, agencyRole: null }, "client_viewer", client)).toMatchObject({ view: true, editLeads: false });
    expect(permissions({ isAgency: false, agencyRole: null }, null, client).view).toBe(false);
    expect(permissions({ isAgency: false, agencyRole: null }, "client_owner", { clientsCanEditLeads: false }).editLeads).toBe(false);
  });
});

describe("reports", () => {
  const L = (o: Partial<ReportLead>): ReportLead => ({ createdAt: new Date("2026-10-10T15:00:00Z"), channel: "google_ads", status: "new", type: "form", valueCents: 15000, saleCents: null, landingPage: "https://x.com/roof/", ...o });
  const leads = [L({}), L({ status: "won", saleCents: 1200000, type: "call" }), L({ channel: "gbp", status: "qualified" }), L({ status: "spam" }), L({ channel: "gbp", createdAt: new Date("2026-10-25T15:00:00Z") })];
  it("summarizes, excluding spam", () => {
    expect(summarize(leads)).toMatchObject({ leads: 4, qualified: 2, calls: 1, forms: 3, won: 1, wonCents: 1200000, spam: 1 });
  });
  it("groups by channel and week", () => {
    expect(byChannel(leads).map((r) => [r.channel, r.leads])).toEqual([["google_ads", 2], ["gbp", 2]]);
    expect(byWeek(leads, "America/Chicago", 31).map((w) => w.total)).toEqual([0, 3, 0, 1]);
    expect(topLandingPages(leads)[0]).toEqual(["/roof/", 4]);
  });
  it("month range uses the client's time zone", () => {
    const { start, end } = monthRange("2026-11", "America/Chicago");
    expect(start.toISOString()).toBe("2026-11-01T05:00:00.000Z"); // midnight Nov 1 is still daylight time (CDT)
    expect(end.toISOString()).toBe("2026-12-01T06:00:00.000Z");
  });
});

describe("journey", () => {
  it("shows first visit, return visit and the lead", () => {
    const s = journeySteps({ ts: "2026-10-01T10:00:00Z", referrer: "https://www.google.com/", landing: "https://x.com/" },
      { ts: "2026-10-04T10:00:00Z", utm_source: "google", utm_medium: "gbp", utm_campaign: "gbp-listing", landing: "https://x.com/" },
      { type: "call", createdAt: new Date("2026-10-04T10:05:00Z"), callDurationSec: 125, formName: null });
    expect(s.map((x) => x.title)).toEqual(["First visit · Google or Bing search", "Came back · Google Business Profile", "Called · 2m 5s"]);
  });
});

describe("util", () => {
  it("parses dollars and domains", () => {
    expect(parseDollars("$1,250")).toBe(125000);
    expect(parseDollars("")).toBeNull();
    expect(cleanDomain("https://www.Client.com/contact")).toBe("client.com");
  });
});
