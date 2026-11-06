/**
 * Channel classification for a single touch. First matching rule wins.
 * See docs/PLAN.md section 8.
 */

export type Touch = {
  ts?: string;
  landing?: string;
  referrer?: string;
  direct?: boolean;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  msclkid?: string;
};

export type Channel =
  | "google_ads"
  | "gbp"
  | "paid_social"
  | "microsoft_ads"
  | "email"
  | "other_campaign"
  | "organic_search"
  | "organic_social"
  | "referral"
  | "direct";

export const CHANNEL_LABELS: Record<Channel, string> = {
  google_ads: "Google Ads",
  gbp: "Google Business Profile",
  paid_social: "Paid Social",
  microsoft_ads: "Microsoft Ads",
  email: "Email",
  other_campaign: "Other Campaign",
  organic_search: "Organic Search",
  organic_social: "Organic Social",
  referral: "Referral",
  direct: "Direct",
};

const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.com|duckduckgo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z]+|baidu\.com)$/;
const SOCIAL_HOSTS = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|lnkd\.in|t\.co|twitter\.com|x\.com|youtube\.com|tiktok\.com|pinterest\.com|nextdoor\.com|reddit\.com|threads\.net)$/;

const lc = (v?: string) => (v ?? "").trim().toLowerCase();

function refHost(referrer?: string): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function classify(t: Touch | null | undefined): Channel {
  if (!t) return "direct";
  const source = lc(t.utm_source);
  const medium = lc(t.utm_medium);
  const campaign = lc(t.utm_campaign);

  if (t.gclid || t.gbraid || t.wbraid) return "google_ads";
  if (source === "google" && ["cpc", "ppc", "paid", "paidsearch"].includes(medium)) return "google_ads";
  if (medium === "gbp" || campaign.startsWith("gbp")) return "gbp";
  if (t.fbclid && !medium) return "paid_social";
  if (["paid_social", "paidsocial", "cpm", "paid-social"].includes(medium)) return "paid_social";
  if (t.msclkid) return "microsoft_ads";
  if (medium === "email" || medium === "newsletter") return "email";
  if (source || medium || campaign) return "other_campaign";

  const host = refHost(t.referrer);
  if (host) {
    if (SEARCH_HOSTS.test(host)) return "organic_search";
    if (SOCIAL_HOSTS.test(host)) return "organic_social";
    return "referral";
  }
  return "direct";
}

/** Human-readable "source / medium" for tables. */
export function sourceMedium(t: Touch | null | undefined): string {
  if (!t) return "(direct) / (none)";
  if (t.utm_source || t.utm_medium) return `${t.utm_source ?? "(not set)"} / ${t.utm_medium ?? "(not set)"}`;
  if (t.gclid || t.gbraid || t.wbraid) return "google / cpc";
  const host = refHost(t.referrer);
  if (host) {
    const ch = classify(t);
    return `${host} / ${ch === "organic_search" ? "organic" : ch === "organic_social" ? "social" : "referral"}`;
  }
  return "(direct) / (none)";
}

/** Attribution payload the snippet writes into the hidden sb_data field. */
export type SbData = {
  v: number;
  vid: string;
  sid?: string;
  ga?: string | null;
  ft?: Touch;
  lt?: Touch;
};

export function parseSbData(raw: unknown): SbData | null {
  if (typeof raw !== "string" || !raw.trim().startsWith("{")) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d.vid !== "string") return null;
    return d as SbData;
  } catch {
    return null;
  }
}
