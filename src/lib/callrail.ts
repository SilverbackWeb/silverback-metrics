/**
 * Parse a CallRail "Post-Call" webhook into a lead.
 *
 * CallRail sends the call plus the attribution its own tracking saw (source, landing page,
 * referrer, UTMs, gclid, keyword). Field names have varied between webhook versions, so
 * every field is read from a list of aliases, and the parser accepts JSON or form-encoded bodies.
 */
import type { Channel, Touch } from "./attribution";
import { classify } from "./attribution";

export type ParsedCall = {
  callId: string | null;
  callerName: string | null;
  callerPhone: string | null;
  trackingNumber: string | null;
  durationSec: number | null;
  answered: boolean | null;
  firstCall: boolean | null;
  recordingUrl: string | null;
  startedAt: Date | null;
  sourceName: string | null;
  campaign: string | null;
  keyword: string | null;
  touch: Touch | null;
  channel: Channel;
};

type Obj = Record<string, unknown>;

function pick(o: Obj, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s && s !== "null" && s !== "undefined") return s;
  }
  return null;
}

function bool(v: string | null) {
  if (v === null) return null;
  return ["true", "1", "yes", "t"].includes(v.toLowerCase());
}

/** CallRail's own "source" label, for calls without UTMs or click IDs. */
export function channelFromSourceName(name: string | null): Channel | null {
  if (!name) return null;
  const s = name.toLowerCase();
  if (/(google (ads|adwords|paid|cpc)|adwords|google ppc)/.test(s)) return "google_ads";
  if (/(my business|gmb|business profile|google maps|gbp)/.test(s)) return "gbp";
  if (/(bing ads|microsoft ads|bing paid)/.test(s)) return "microsoft_ads";
  if (/(facebook|instagram|meta).*(paid|ads)|(paid|ads).*(facebook|instagram|meta)/.test(s)) return "paid_social";
  if (/(google|bing|yahoo|duckduckgo).*(organic)|organic search/.test(s)) return "organic_search";
  if (/(facebook|instagram|linkedin|nextdoor|youtube|tiktok)/.test(s)) return "organic_social";
  if (/direct/.test(s)) return "direct";
  if (/email|newsletter/.test(s)) return "email";
  return null;
}

export function parseCallRail(input: Obj): ParsedCall {
  // Some webhook versions nest the call under "call" or "resource".
  const o: Obj = { ...input, ...((input.call as Obj) ?? {}), ...((input.resource as Obj) ?? {}) };

  const landing = pick(o, "landing_page_url", "landing_page", "landingpage");
  const referrer = pick(o, "referring_url", "referrer_url", "referrer", "referrer_domain");
  const touch: Touch = {
    ts: pick(o, "start_time", "started_at", "datetime", "created_at") ?? undefined,
    landing: landing ?? undefined,
    referrer: referrer && /^https?:\/\//.test(referrer) ? referrer : referrer ? `https://${referrer}` : undefined,
    utm_source: pick(o, "utm_source", "utmsource") ?? undefined,
    utm_medium: pick(o, "utm_medium", "utmmedium") ?? undefined,
    utm_campaign: pick(o, "utm_campaign", "utmcampaign") ?? undefined,
    utm_term: pick(o, "utm_term", "utmterm") ?? undefined,
    utm_content: pick(o, "utm_content", "utmcontent") ?? undefined,
    gclid: pick(o, "gclid") ?? undefined,
    fbclid: pick(o, "fbclid") ?? undefined,
    msclkid: pick(o, "msclkid") ?? undefined,
  };
  // Fill UTMs from the landing page URL if CallRail only sent the URL.
  if (landing) {
    try {
      const q = new URL(landing).searchParams;
      for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid", "msclkid"] as const) {
        if (!touch[k] && q.get(k)) touch[k] = q.get(k)!;
      }
    } catch { /* not a URL */ }
  }
  const hasAttribution = Object.entries(touch).some(([k, v]) => v && k !== "ts" && k !== "landing");
  const sourceName = pick(o, "source_name", "source", "tracking_source", "formatted_tracking_source");

  // Our own rules first (UTMs, click IDs, referrer); CallRail's source label when those are empty.
  let channel: Channel = hasAttribution ? classify(touch) : "direct";
  if (channel === "direct" || channel === "other_campaign") channel = channelFromSourceName(sourceName) ?? channel;

  const dur = pick(o, "duration", "call_duration", "duration_seconds");
  const started = touch.ts ? new Date(touch.ts) : null;

  return {
    callId: pick(o, "id", "resource_id", "call_id", "callid"),
    callerName: pick(o, "customer_name", "caller_name", "callername", "name"),
    callerPhone: pick(o, "customer_phone_number", "caller_number", "callernum", "customer_phone"),
    trackingNumber: pick(o, "tracking_phone_number", "trackingnum", "tracking_number"),
    durationSec: dur !== null && !Number.isNaN(Number(dur)) ? Math.round(Number(dur)) : null,
    answered: bool(pick(o, "answered")),
    firstCall: bool(pick(o, "first_call", "firstcall")),
    recordingUrl: pick(o, "recording_player", "recording", "recording_url"),
    startedAt: started && !Number.isNaN(started.getTime()) ? started : null,
    sourceName,
    campaign: pick(o, "campaign", "utm_campaign", "tracking_campaign"),
    keyword: pick(o, "keywords", "keyword", "utm_term"),
    touch: hasAttribution || landing ? touch : null,
    channel,
  };
}

/** Why a call shouldn't count as a lead (missed, too short). Empty means it counts. */
export function callNotLeadReasons(c: ParsedCall, minSeconds: number) {
  const r: string[] = [];
  if (c.answered === false) r.push("missed call");
  else if (c.durationSec !== null && c.durationSec < minSeconds) r.push(`short call (${c.durationSec}s, under ${minSeconds}s)`);
  return r;
}
