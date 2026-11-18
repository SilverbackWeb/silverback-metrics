"use server";
/** Team-only actions shared by the SEO and Local & Maps tabs. Each one re-checks access. */
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireClient } from "@/lib/access";
import { MAX_PAIRS, runRankCheck, runRankedSnapshot } from "@/lib/seo";
import { queueHeatmaps } from "@/lib/heatmap";
import { normalizeLocation } from "@/lib/locations";

type Back = "seo" | "local";
const to = (clientId: string, back: Back, q = "") => `/c/${clientId}/${back === "local" ? "local" : "seo"}${q}`;

async function team(clientId: string) {
  const r = await requireClient(clientId);
  if (!r.user.isAgency) notFound();
  return r;
}

export async function addKeywords(clientId: string, back: Back, form: FormData) {
  const { client } = await team(clientId);
  const words = String(form.get("keywords") ?? "").split(/[\n,]/).map((s) => s.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.rankKeywords).where(eq(schema.rankKeywords.clientId, client.id));
  const room = Math.floor(MAX_PAIRS / Math.max(1, client.rankLocations.length)) - n;
  if (words.length > room) redirect(to(clientId, back, "?e=max"));
  if (words.length) {
    await db.insert(schema.rankKeywords).values(words.map((keyword) => ({ clientId: client.id, keyword }))).onConflictDoNothing();
    await db.update(schema.clients).set({ rankCheckedAt: null }).where(eq(schema.clients.id, client.id)); // checked within the hour
  }
  redirect(to(clientId, back));
}

export async function removeKeyword(clientId: string, back: Back, keywordId: string) {
  const { client } = await team(clientId);
  await db.delete(schema.rankKeywords).where(and(eq(schema.rankKeywords.id, keywordId), eq(schema.rankKeywords.clientId, client.id)));
  redirect(to(clientId, back));
}

export async function saveLocations(clientId: string, back: Back, form: FormData) {
  const { client } = await team(clientId);
  const locs = [...new Set(String(form.get("locations") ?? "").split("\n").map((s) => normalizeLocation(s)).filter((s): s is string => !!s))].slice(0, 3);
  const gbpName = String(form.get("gbpName") ?? "").trim() || null;
  // Forget listings for removed areas, or all of them if the business name changed (they're found again on the next check).
  const places = gbpName === client.gbpName ? Object.fromEntries(Object.entries(client.gbpPlaces).filter(([l]) => locs.includes(l))) : {};
  await db.update(schema.clients).set({ rankLocations: locs, gbpName, gbpPlaces: places, rankCheckedAt: null, rankCheckError: null })
    .where(eq(schema.clients.id, client.id));
  redirect(to(clientId, back, "?saved=1"));
}

export async function checkNow(clientId: string, back: Back) {
  const { client } = await team(clientId);
  // At most once every 10 minutes, so a double-click can't run up the DataForSEO bill.
  if (client.rankCheckedAt && !client.rankCheckError && Date.now() - client.rankCheckedAt.getTime() < 10 * 60e3) redirect(to(clientId, back, "?e=wait"));
  await Promise.all([runRankCheck(client.id), runRankedSnapshot(client.id)]);
  redirect(to(clientId, back));
}

export async function runHeatmapNow(clientId: string) {
  const { client } = await team(clientId);
  // One run a day at most: each run is 49 lookups per keyword and area.
  const [recent] = await db.select({ id: schema.heatmapScans.id }).from(schema.heatmapScans)
    .where(and(eq(schema.heatmapScans.clientId, client.id), gt(schema.heatmapScans.createdAt, new Date(Date.now() - 864e5)))).limit(1);
  if (recent) redirect(to(clientId, "local", "?e=hmwait#heatmap"));
  const h = await headers();
  const base = (process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`).replace(/\/$/, "");
  let ok = true;
  try { await queueHeatmaps(client.id, base); } catch { ok = false; }
  redirect(to(clientId, "local", ok ? "?e=hmqueued#heatmap" : "?e=hmfail#heatmap"));
}
