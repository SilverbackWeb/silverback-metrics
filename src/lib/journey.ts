/** Turn a lead's stored touches into readable journey steps. Pure, unit-tested. */
import { classify, type Touch } from "./attribution";
import { pathOf } from "./reports";

export type Step = { channel: string; title: string; detail: string; at: Date | null };

const label: Record<string, string> = {
  google_ads: "Google Ads", gbp: "Google Business Profile", organic_search: "Google or Bing search", paid_social: "Paid social ad",
  microsoft_ads: "Microsoft Ads", email: "Email", other_campaign: "Tagged link", organic_social: "Social media", referral: "Another website", direct: "Typed the address",
};

export function describeTouch(t: Touch) {
  const parts: string[] = [];
  const page = pathOf(t.landing ?? null);
  if (page) parts.push(`landed on ${page}`);
  const utm = [t.utm_source && `utm_source=${t.utm_source}`, t.utm_medium && `utm_medium=${t.utm_medium}`, t.utm_campaign && `utm_campaign=${t.utm_campaign}`, t.utm_term && `utm_term=${t.utm_term}`].filter(Boolean);
  if (utm.length) parts.push(utm.join(" · "));
  if (t.gclid || t.gbraid || t.wbraid) parts.push("Google Ads click ID ✓");
  if (t.referrer && !utm.length) { try { parts.push(`from ${new URL(t.referrer).hostname.replace(/^www\./, "")}`); } catch { /* ignore */ } }
  return parts.join(" · ");
}

export function journeySteps(ft: Touch | null, lt: Touch | null, lead: { type: string; createdAt: Date; callDurationSec: number | null; formName: string | null }): Step[] {
  const steps: Step[] = [];
  const same = ft && lt && ft.ts === lt.ts && ft.landing === lt.landing;
  if (ft && !same) {
    const ch = classify(ft);
    steps.push({ channel: ch, title: `First visit · ${label[ch]}`, detail: describeTouch(ft), at: ft.ts ? new Date(ft.ts) : null });
  }
  const last = lt ?? ft;
  if (last) {
    const ch = classify(last);
    steps.push({ channel: ch, title: `${ft && !same ? "Came back" : "Arrived"} · ${label[ch]}`, detail: describeTouch(last), at: last.ts ? new Date(last.ts) : null });
  }
  const dur = lead.callDurationSec;
  steps.push({
    channel: "lead",
    title: lead.type === "call" ? `Called${dur ? ` · ${Math.floor(dur / 60)}m ${dur % 60}s` : ""}` : `Submitted ${lead.formName ? `the ${lead.formName} form` : "a form"}`,
    detail: "", at: lead.createdAt,
  });
  return steps;
}
