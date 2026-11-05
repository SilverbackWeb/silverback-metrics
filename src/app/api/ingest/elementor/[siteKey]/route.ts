/**
 * Elementor Pro Forms "Webhook" action target.
 * URL: /api/ingest/elementor/SITE_KEY?token=INGEST_TOKEN   (turn on "Advanced Data")
 */
import { db, schema } from "@/db";
import { classify } from "@/lib/attribution";
import { parseElementor, spamScore } from "@/lib/elementor";
import { siteByKeyAndToken } from "@/lib/touches";

export async function POST(req: Request, ctx: { params: Promise<{ siteKey: string }> }) {
  const { siteKey } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token");
  const site = await siteByKeyAndToken(siteKey, token);
  if (!site) return Response.json({ ok: false, error: "unknown site or bad token" }, { status: 401 });

  const ct = req.headers.get("content-type") ?? "";
  const body = ct.includes("application/json")
    ? parseElementor(await req.json())
    : parseElementor(new URLSearchParams(await req.text()));

  const attr = body.attribution;
  const last = attr?.lt ?? attr?.ft ?? null;
  const spam = spamScore(body);

  const [client] = await db.query.clients.findMany({ where: (c, { eq }) => eq(c.id, site.clientId), limit: 1 });

  const [lead] = await db.insert(schema.leads).values({
    clientId: site.clientId,
    siteId: site.id,
    visitorId: attr?.vid ?? null,
    type: "form",
    source: "elementor",
    status: spam.score >= 2 ? "spam" : "new",
    spamReasons: spam.reasons.length ? spam.reasons : null,
    name: body.name, email: body.email, phone: body.phone, message: body.message,
    formName: body.formName, pageUrl: body.pageUrl,
    channel: classify(last),
    firstChannel: attr?.ft ? classify(attr.ft) : null,
    utmSource: last?.utm_source, utmMedium: last?.utm_medium, utmCampaign: last?.utm_campaign,
    utmTerm: last?.utm_term, utmContent: last?.utm_content,
    landingPage: last?.landing, referrer: last?.referrer,
    gclid: last?.gclid ?? attr?.ft?.gclid,
    gaClientId: attr?.ga ?? null,
    firstTouch: attr?.ft ?? null,
    lastTouch: attr?.lt ?? null,
    valueCents: client?.defaultFormValueCents || null,
    raw: { fields: body.fields, remoteIp: body.remoteIp, userAgent: body.userAgent, formId: body.formId },
  }).returning({ id: schema.leads.id });

  // TODO(phase 1): enqueue "new lead" email alert and backup-copy dedupe job.
  return Response.json({ ok: true, id: lead.id });
}
