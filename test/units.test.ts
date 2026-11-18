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

describe("heat map grid", () => {
  it("is centered on the listing with north at the top, about 5 miles each way", async () => {
    const { gridPoints } = await import("@/lib/heatmap");
    const pts = gridPoints(38.58, -90.4, 7, 5);
    expect(pts).toHaveLength(49);
    expect(pts[24]).toMatchObject({ row: 3, col: 3, lat: 38.58, lng: -90.4 });
    expect(pts[0].lat).toBeGreaterThan(38.58);
    expect(pts[0].lng).toBeLessThan(-90.4);
    expect((pts[3].lat - 38.58) * 69).toBeCloseTo(5, 1);
  });
});

describe("locations", () => {
  it("turns 'Kirkwood, MO' into DataForSEO's location name", async () => {
    const { normalizeLocation } = await import("@/lib/locations");
    expect(normalizeLocation("Kirkwood, MO")).toBe("Kirkwood,Missouri,United States");
    expect(normalizeLocation("st louis, mo")).toBe("Saint Louis,Missouri,United States");
    expect(normalizeLocation("Arnold,Missouri,United States")).toBe("Arnold,Missouri,United States");
    expect(normalizeLocation("  ")).toBeNull();
  });
});

describe("all keywords table", () => {
  it("filters and sorts", async () => {
    const { filterSort } = await import("@/lib/keyword-table");
    const rows = [
      { keyword: "electrician", position: 2, prev: 5, change: 3, url: null, searchVolume: 900, etv: 50 },
      { keyword: "panel upgrade", position: 14, prev: 9, change: -5, url: null, searchVolume: 100, etv: 2 },
      { keyword: "ev charger install", position: 40, prev: null, change: null, url: null, searchVolume: 300, etv: 0 },
    ];
    const lost = [{ keyword: "generator", position: null, prev: 8, change: null, url: null, searchVolume: 50, etv: null }];
    expect(filterSort(rows, lost, "all", "volume", "").map((r) => r.keyword)).toEqual(["electrician", "ev charger install", "panel upgrade"]);
    expect(filterSort(rows, lost, "page2", "volume", "").map((r) => r.keyword)).toEqual(["panel upgrade"]);
    expect(filterSort(rows, lost, "up", "volume", "")).toHaveLength(1);
    expect(filterSort(rows, lost, "new", "volume", "")[0].keyword).toBe("ev charger install");
    expect(filterSort(rows, lost, "lost", "volume", "")[0].keyword).toBe("generator");
    expect(filterSort(rows, lost, "all", "position", "").map((r) => r.position)).toEqual([2, 14, 40]);
    expect(filterSort(rows, lost, "all", "volume", "PANEL")).toHaveLength(1);
  });
});
