/** Nightly pulls from Google Ads (incl. Local Services) and Search Console, per client. */
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { connection, gaql, gsc } from "./google";

const DAY = 864e5;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** "2026-11-17 10:20:00" in the client's time zone -> Date (UTC). */
export function zonedToUtc(local: string, tz: string) {
  const asUtc = new Date(local.replace(" ", "T").slice(0, 19) + "Z");
  if (Number.isNaN(asUtc.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(asUtc).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(asUtc.getTime() - (shown - asUtc.getTime()));
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function adsRows(clientId: string, results: Row[]) {
  return results.map((r) => ({
    clientId, day: r.segments.date as string, campaignId: String(r.campaign.id), campaignName: r.campaign.name ?? null,
    impressions: Number(r.metrics?.impressions ?? 0), clicks: Number(r.metrics?.clicks ?? 0),
    costMicros: Number(r.metrics?.costMicros ?? 0), conversions: Number(r.metrics?.conversions ?? 0),
    channelType: r.campaign.advertisingChannelType ?? "",
  }));
}

export function lsaLeads(client: { id: string; timezone: string; defaultCallValueCents: number; defaultFormValueCents: number }, results: Row[]) {
  return results.map((r) => {
    const l = r.localServicesLead ?? {};
    const c = l.contactDetails ?? {};
    const type = l.leadType === "PHONE_CALL" ? "call" : l.leadType === "MESSAGE" ? "chat" : "other";
    const declined = ["DECLINED", "CONSUMER_DECLINED", "WIPED_OUT", "DISABLED"].includes(l.leadStatus);
    return {
      clientId: client.id, type: type as "call" | "chat" | "other", source: "lsa", externalId: String(l.resourceName ?? l.id),
      status: (declined ? "spam" : "new") as "spam" | "new", spamReasons: declined ? [`Google marked it ${String(l.leadStatus).toLowerCase().replace(/_/g, " ")}`] : null,
      name: c.consumerName ?? null, phone: c.phoneNumber ?? null, email: c.email ?? null,
      channel: "local_services", utmSource: "google", utmMedium: "lsa",
      valueCents: declined ? null : (type === "call" ? client.defaultCallValueCents : client.defaultFormValueCents) || null,
      raw: { lsa: { type: l.leadType, status: l.leadStatus, charged: l.leadCharged ?? null, categoryId: l.categoryId ?? null } },
      ...(l.creationDateTime ? { createdAt: zonedToUtc(l.creationDateTime, client.timezone) ?? new Date() } : {}),
    };
  });
}

async function syncAds(client: typeof schema.clients.$inferSelect, customerId: string) {
  const res = await gaql(customerId, `SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM campaign WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0`);
  const rows = adsRows(client.id, res);
  if (rows.length) await db.insert(schema.adsDaily).values(rows).onConflictDoUpdate({
    target: [schema.adsDaily.clientId, schema.adsDaily.day, schema.adsDaily.campaignId],
    set: { campaignName: sql`excluded.campaign_name`, impressions: sql`excluded.impressions`, clicks: sql`excluded.clicks`, costMicros: sql`excluded.cost_micros`, conversions: sql`excluded.conversions`, channelType: sql`excluded.channel_type` },
  });

  // Local Services Ads leads live in the same Ads account. Accounts without LSA just return nothing.
  if (rows.some((r) => r.channelType === "LOCAL_SERVICES")) {
    const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 19).replace("T", " ");
    const leads = await gaql(customerId, `SELECT local_services_lead.resource_name, local_services_lead.id, local_services_lead.lead_type,
      local_services_lead.contact_details, local_services_lead.lead_status, local_services_lead.creation_date_time,
      local_services_lead.lead_charged, local_services_lead.category_id
      FROM local_services_lead WHERE local_services_lead.creation_date_time >= '${since}'`);
    const vals = lsaLeads(client, leads);
    if (vals.length) await db.insert(schema.leads).values(vals).onConflictDoNothing();
  }
}

async function syncGsc(clientId: string, site: string) {
  const enc = encodeURIComponent(site);
  const end = new Date(Date.now() - 2 * DAY), start = new Date(Date.now() - 95 * DAY);
  const daily = await gsc(`sites/${enc}/searchAnalytics/query`, { startDate: iso(start), endDate: iso(end), dimensions: ["date"], rowLimit: 200 });
  const rows = ((daily.rows ?? []) as Row[]).map((r) => ({ clientId, day: r.keys[0] as string, clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), avgPosition: r.position ?? null }));
  if (rows.length) await db.insert(schema.gscDaily).values(rows).onConflictDoUpdate({
    target: [schema.gscDaily.clientId, schema.gscDaily.day],
    set: { clicks: sql`excluded.clicks`, impressions: sql`excluded.impressions`, avgPosition: sql`excluded.avg_position` },
  });
  const s28 = iso(new Date(Date.now() - 30 * DAY));
  const [q, p] = await Promise.all(["query", "page"].map((dim) =>
    gsc(`sites/${enc}/searchAnalytics/query`, { startDate: s28, endDate: iso(end), dimensions: [dim], rowLimit: 25 })));
  const top = [...((q.rows ?? []) as Row[]).map((r) => ({ kind: "query", r })), ...((p.rows ?? []) as Row[]).map((r) => ({ kind: "page", r }))]
    .map(({ kind, r }) => ({ clientId, kind, key: String(r.keys[0]).slice(0, 500), clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: r.position ?? null }));
  await db.delete(schema.gscTop).where(eq(schema.gscTop.clientId, clientId));
  if (top.length) await db.insert(schema.gscTop).values(top).onConflictDoNothing();
}

/** Sync one client's Google integrations, recording success or the error on each. */
export async function syncClient(clientId: string) {
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).limit(1);
  if (!client) return;
  const ints = await db.select().from(schema.integrations)
    .where(and(eq(schema.integrations.clientId, clientId), inArray(schema.integrations.kind, ["google_ads", "gsc"])));
  for (const i of ints) {
    if (!i.externalId) continue;
    try {
      if (i.kind === "google_ads") await syncAds(client, i.externalId);
      else await syncGsc(client.id, i.externalId);
      await db.update(schema.integrations).set({ lastSyncAt: new Date(), lastSyncError: null }).where(eq(schema.integrations.id, i.id));
    } catch (e) {
      await db.update(schema.integrations).set({ lastSyncAt: new Date(), lastSyncError: (e as Error).message.slice(0, 300) }).where(eq(schema.integrations.id, i.id));
    }
  }
}

/** Hourly: sync up to `n` clients whose Google data is more than 20 hours old. */
export async function googleHourly(n = 3) {
  if (!(await connection())) return [];
  const due = await db.selectDistinct({ clientId: schema.integrations.clientId }).from(schema.integrations)
    .where(and(inArray(schema.integrations.kind, ["google_ads", "gsc"]), sql`${schema.integrations.externalId} is not null`,
      or(isNull(schema.integrations.lastSyncAt), lt(schema.integrations.lastSyncAt, new Date(Date.now() - 20 * 3600e3)))))
    .limit(n);
  for (const d of due) await syncClient(d.clientId);
  return due.map((d) => d.clientId);
}
