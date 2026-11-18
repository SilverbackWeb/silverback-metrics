/** Report math. Pure functions over lead rows, unit-tested in test/reports.test.ts. */
import { CHANNEL_LABELS, type Channel } from "./attribution";

export type ReportLead = {
  createdAt: Date;
  channel: string;
  status: "new" | "qualified" | "spam" | "won" | "lost";
  type: string;
  valueCents: number | null;
  saleCents: number | null;
  landingPage: string | null;
};

export const CHANNEL_ORDER: Channel[] = ["google_ads", "gbp", "organic_search", "paid_social", "microsoft_ads", "email", "other_campaign", "organic_social", "referral", "direct"];
export const isCounted = (l: Pick<ReportLead, "status">) => l.status !== "spam";
export const isQualified = (l: Pick<ReportLead, "status">) => l.status === "qualified" || l.status === "won";

/** Month as "YYYY-MM". Start/end are instants at local midnight in the client's time zone. */
export function monthRange(ym: string, tz: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error("bad month");
  const y = Number(m[1]), mo = Number(m[2]) - 1;
  return { start: zonedMidnight(y, mo, 1, tz), end: zonedMidnight(mo === 11 ? y + 1 : y, (mo + 1) % 12, 1, tz) };
}

export function currentMonth(tz: string, now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

export function shiftMonth(ym: string, by: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function zonedMidnight(y: number, mo: number, d: number, tz: string) {
  const guess = Date.UTC(y, mo, d);
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset - (tzOffsetMs(new Date(guess - offset), tz) - offset));
}

function tzOffsetMs(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - at.getTime();
}

/** Day of month (1-31) of an instant, in the client's time zone. */
export function localDay(at: Date, tz: string) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" }).format(at));
}

export function summarize(leads: ReportLead[]) {
  const counted = leads.filter(isCounted);
  const won = counted.filter((l) => l.status === "won");
  return {
    leads: counted.length,
    qualified: counted.filter(isQualified).length,
    calls: counted.filter((l) => l.type === "call").length,
    forms: counted.filter((l) => l.type === "form").length,
    won: won.length,
    wonCents: won.reduce((a, l) => a + (l.saleCents ?? 0), 0),
    pipelineCents: counted.filter((l) => l.status !== "lost").reduce((a, l) => a + (l.status === "won" ? (l.saleCents ?? l.valueCents ?? 0) : (l.valueCents ?? 0)), 0),
    spam: leads.length - counted.length,
  };
}

export function byChannel(leads: ReportLead[]) {
  const counted = leads.filter(isCounted);
  return CHANNEL_ORDER.map((ch) => {
    const x = counted.filter((l) => l.channel === ch);
    return {
      channel: ch,
      label: CHANNEL_LABELS[ch],
      leads: x.length,
      qualified: x.filter(isQualified).length,
      won: x.filter((l) => l.status === "won").length,
      wonCents: x.reduce((a, l) => a + (l.status === "won" ? (l.saleCents ?? 0) : 0), 0),
    };
  }).filter((r) => r.leads > 0);
}

/** Leads per week of the month (1-7, 8-14, 15-21, 22-end), stacked by channel. */
export function byWeek(leads: ReportLead[], tz: string, daysInMonth: number) {
  const weeks = [[1, 7], [8, 14], [15, 21], [22, daysInMonth]] as const;
  const counted = leads.filter(isCounted);
  return weeks.map(([a, b]) => {
    const x = counted.filter((l) => { const d = localDay(l.createdAt, tz); return d >= a && d <= b; });
    const parts = CHANNEL_ORDER.map((ch) => ({ channel: ch, n: x.filter((l) => l.channel === ch).length })).filter((p) => p.n > 0);
    return { from: a, to: b, total: x.length, parts };
  });
}

export function topLandingPages(leads: ReportLead[], limit = 5) {
  const m = new Map<string, number>();
  for (const l of leads.filter(isCounted)) {
    const p = pathOf(l.landingPage);
    if (p) m.set(p, (m.get(p) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function pathOf(url: string | null) {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return url; }
}

export const money = (cents: number | null | undefined) =>
  cents == null ? "—" : "$" + Math.round(cents / 100).toLocaleString("en-US");

export function pctChange(cur: number, prev: number) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}
