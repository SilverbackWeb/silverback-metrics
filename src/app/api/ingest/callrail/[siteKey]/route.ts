/**
 * CallRail "Post-Call" webhook target (CallRail → Settings → Integrations → Webhooks).
 * URL: /api/ingest/callrail/SITE_KEY?token=INGEST_TOKEN
 * Each call becomes a lead with the source CallRail tracked. Retries of the same call are ignored.
 */
import { db, schema } from "@/db";
import { callNotLeadReasons, parseCallRail } from "@/lib/callrail";
import { siteByKeyAndToken } from "@/lib/touches";
import { respondWithin, withRetry } from "@/lib/background";

async function handle(req: Request, ctx: { params: Promise<{ siteKey: string }> }) {
  const { siteKey } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token");
  const site = await withRetry(() => siteByKeyAndToken(siteKey, token));
  if (!site) return Response.json({ ok: false, error: "unknown site or bad token" }, { status: 401 });

  const text = await req.text();
  let input: Record<string, unknown>;
  try {
    input = (req.headers.get("content-type") ?? "").includes("json") || text.trim().startsWith("{")
      ? JSON.parse(text)
      : Object.fromEntries(new URLSearchParams(text));
  } catch {
    return Response.json({ ok: false, error: "unreadable body" }, { status: 400 });
  }

  const c = parseCallRail(input);
  const [client] = await withRetry(() => db.query.clients.findMany({ where: (cl, { eq }) => eq(cl.id, site.clientId), limit: 1 }));
  const notLead = callNotLeadReasons(c, client?.minCallSecondsForLead ?? 60);
  const t = c.touch;

  const [lead] = await withRetry(() => db.insert(schema.leads).values({
    clientId: site.clientId,
    siteId: site.id,
    type: "call",
    source: "callrail",
    externalId: c.callId,
    status: notLead.length ? "spam" : "new",
    spamReasons: notLead.length ? notLead : null,
    name: c.callerName,
    phone: c.callerPhone,
    channel: c.channel,
    utmSource: t?.utm_source, utmMedium: t?.utm_medium, utmCampaign: t?.utm_campaign,
    utmTerm: t?.utm_term, utmContent: t?.utm_content,
    landingPage: t?.landing, referrer: t?.referrer,
    gclid: t?.gclid,
    lastTouch: t,
    adsKeyword: c.channel === "google_ads" ? c.keyword : null,
    adsCampaignName: c.channel === "google_ads" ? c.campaign : null,
    callDurationSec: c.durationSec,
    recordingUrl: c.recordingUrl,
    valueCents: notLead.length ? null : client?.defaultCallValueCents || null,
    raw: { callrailSource: c.sourceName, callrailCampaign: c.campaign, keyword: c.keyword, trackingNumber: c.trackingNumber, firstCall: c.firstCall, answered: c.answered },
    ...(c.startedAt ? { createdAt: c.startedAt } : {}),
  }).onConflictDoNothing().returning({ id: schema.leads.id }));

  return Response.json({ ok: true, id: lead?.id ?? null, duplicate: !lead });
}

export async function POST(req: Request, ctx: { params: Promise<{ siteKey: string }> }) {
  // Read the body now: it can't be read after we've answered the sender.
  const copy = new Request(req.url, { method: "POST", headers: req.headers, body: await req.text() });
  return respondWithin(4000, handle(copy, ctx));
}
