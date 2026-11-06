import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { classify, type Touch } from "./attribution";

/** Store a touch and point the visitor's first/last touch at it. */
export async function recordTouch(siteId: string, visitorId: string, t: Touch, opts: { isFirst?: boolean; gaClientId?: string | null } = {}) {
  const [row] = await db.insert(schema.touches).values({
    siteId,
    visitorId,
    ts: t.ts ? new Date(t.ts) : new Date(),
    channel: classify(t),
    landing: t.landing?.slice(0, 2000),
    referrer: t.referrer?.slice(0, 2000),
    utmSource: t.utm_source, utmMedium: t.utm_medium, utmCampaign: t.utm_campaign,
    utmTerm: t.utm_term, utmContent: t.utm_content,
    gclid: t.gclid, gbraid: t.gbraid, wbraid: t.wbraid, fbclid: t.fbclid, msclkid: t.msclkid,
  }).returning({ id: schema.touches.id });

  const update: Partial<typeof schema.visitors.$inferInsert> = { lastSeenAt: new Date() };
  if (!t.direct || opts.isFirst) update.lastTouchId = row.id;
  if (opts.gaClientId) update.gaClientId = opts.gaClientId;

  await db.insert(schema.visitors)
    .values({ id: visitorId, siteId, firstTouchId: row.id, lastTouchId: row.id, gaClientId: opts.gaClientId ?? null })
    .onConflictDoUpdate({ target: schema.visitors.id, set: update, where: eq(schema.visitors.siteId, siteId) });
  return row.id;
}

export async function siteByKey(siteKey: string) {
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.siteKey, siteKey)).limit(1);
  return site ?? null;
}

export async function siteByKeyAndToken(siteKey: string, token: string | null) {
  if (!token) return null;
  const [site] = await db.select().from(schema.sites)
    .where(and(eq(schema.sites.siteKey, siteKey), eq(schema.sites.ingestToken, token))).limit(1);
  return site ?? null;
}
