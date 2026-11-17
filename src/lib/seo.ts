/** Rank checks for tracked keywords, and "every keyword we rank for" snapshots. */
import { and, desc, eq, inArray, lt, or, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { cleanDomain } from "./util";
import { dfsPost, findMaps, findOrganic, mapsTask, organicTask, parseRanked, rankedTask } from "./dataforseo";

// Each keyword is checked in each location, on Google and on Maps. Keeping pairs at 10 or fewer keeps a check
// inside the Worker free plan's 50 outbound requests per run (and DataForSEO cost tiny).
export const MAX_PAIRS = 10;
const DAY = 864e5;

export function todayIso(d = new Date()) { return d.toISOString().slice(0, 10); }

export async function clientDomain(clientId: string, website: string | null) {
  const [site] = await db.select({ domain: schema.sites.domain }).from(schema.sites).where(eq(schema.sites.clientId, clientId)).limit(1);
  const d = site?.domain ?? website;
  return d ? cleanDomain(d) : null;
}

/** Check Google and Maps position for each tracked keyword, in each location. */
export async function runRankCheck(clientId: string) {
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).limit(1);
  if (!client) return;
  const domain = await clientDomain(client.id, client.website);
  const kws = await db.select().from(schema.rankKeywords).where(eq(schema.rankKeywords.clientId, client.id));
  const locations = client.rankLocations.length ? client.rankLocations : [];
  try {
    if (!domain) throw new Error("Add the client's website first.");
    if (!locations.length) throw new Error("Add at least one location to check rankings from.");
    if (!kws.length) throw new Error("Add the keywords to track.");
    const day = todayIso();
    const jobs = kws.flatMap((k) => locations.flatMap((loc) => [
      ...(k.trackOrganic ? [{ k, loc, engine: "organic" as const }] : []),
      ...(k.trackMaps ? [{ k, loc, engine: "maps" as const }] : []),
    ]));
    const places = { ...client.gbpPlaces };
    const rows = await Promise.all(jobs.map(async ({ k, loc, engine }) => {
      if (engine === "organic") {
        const r = findOrganic(await dfsPost("serp/google/organic/live/advanced", organicTask(k.keyword, loc)), domain);
        return { keywordId: k.id, day, engine, location: loc, position: r.position, url: r.url, checkedAt: new Date() };
      }
      const r = findMaps(await dfsPost("serp/google/maps/live/advanced", mapsTask(k.keyword, loc)), domain, client.gbpName, places[loc]?.cid);
      if (r.place && !places[loc]) places[loc] = r.place; // remember the listing (heat maps center on it)
      return { keywordId: k.id, day, engine, location: loc, position: r.position, url: r.url, checkedAt: new Date() };
    }));
    if (rows.length) {
      await db.insert(schema.rankResults).values(rows).onConflictDoUpdate({
        target: [schema.rankResults.keywordId, schema.rankResults.day, schema.rankResults.engine, schema.rankResults.location],
        set: { position: sql`excluded.position`, url: sql`excluded.url`, checkedAt: sql`excluded.checked_at` },
      });
    }
    await db.update(schema.clients).set({ rankCheckedAt: new Date(), rankCheckError: null, gbpPlaces: places }).where(eq(schema.clients.id, client.id));
  } catch (e) {
    await db.update(schema.clients).set({ rankCheckedAt: new Date(), rankCheckError: (e as Error).message.slice(0, 300) }).where(eq(schema.clients.id, client.id));
  }
}

/** Save every keyword the site ranks for in the top 20 (one DataForSEO Labs call). */
export async function runRankedSnapshot(clientId: string) {
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).limit(1);
  if (!client) return;
  const domain = await clientDomain(client.id, client.website);
  if (!domain) return;
  try {
    const rows = parseRanked(await dfsPost("dataforseo_labs/google/ranked_keywords/live", rankedTask(domain)));
    const day = todayIso();
    await db.delete(schema.rankedKeywords).where(and(eq(schema.rankedKeywords.clientId, client.id), eq(schema.rankedKeywords.day, day)));
    if (rows.length) await db.insert(schema.rankedKeywords).values(rows.map((r) => ({ ...r, clientId: client.id, day })));
    await db.update(schema.clients).set({ rankedSnapshotAt: new Date() }).where(eq(schema.clients.id, client.id));
  } catch (e) {
    await db.update(schema.clients).set({ rankedSnapshotAt: new Date(), rankCheckError: (e as Error).message.slice(0, 300) }).where(eq(schema.clients.id, client.id));
  }
}

/**
 * Hourly cron: handle one client whose ranks are more than a week old, and one whose keyword
 * snapshot is more than 30 days old. One client per run keeps each run inside the Worker's free-plan limits.
 */
export async function seoHourly() {
  const hasKw = sql`exists (select 1 from ${schema.rankKeywords} where ${schema.rankKeywords.clientId} = ${schema.clients.id})`;
  const [due] = await db.select({ id: schema.clients.id }).from(schema.clients)
    .where(and(hasKw, or(isNull(schema.clients.rankCheckedAt), lt(schema.clients.rankCheckedAt, new Date(Date.now() - 7 * DAY)))))
    .orderBy(schema.clients.rankCheckedAt).limit(1);
  if (due) await runRankCheck(due.id);
  const [snap] = await db.select({ id: schema.clients.id }).from(schema.clients)
    .where(and(hasKw, or(isNull(schema.clients.rankedSnapshotAt), lt(schema.clients.rankedSnapshotAt, new Date(Date.now() - 30 * DAY)))))
    .orderBy(schema.clients.rankedSnapshotAt).limit(1);
  if (snap) await runRankedSnapshot(snap.id);
  return { rankCheck: due?.id ?? null, snapshot: snap?.id ?? null };
}

export type TrackedRow = {
  id: string; keyword: string; location: string;
  organic: number | null; organicPrev: number | null | undefined; organicUrl: string | null;
  maps: number | null; mapsPrev: number | null | undefined;
  checkedAt: Date | null;
};

/** Latest and previous check per keyword + location, for the tracked keywords table. */
export async function trackedTable(clientId: string): Promise<TrackedRow[]> {
  const kws = await db.select().from(schema.rankKeywords).where(eq(schema.rankKeywords.clientId, clientId)).orderBy(schema.rankKeywords.createdAt);
  if (!kws.length) return [];
  const results = await db.select().from(schema.rankResults)
    .where(inArray(schema.rankResults.keywordId, kws.map((k) => k.id))).orderBy(desc(schema.rankResults.day));
  const rows: TrackedRow[] = [];
  for (const k of kws) {
    const mine = results.filter((r) => r.keywordId === k.id);
    const locs = [...new Set(mine.map((r) => r.location))];
    if (!locs.length) { rows.push({ id: k.id, keyword: k.keyword, location: "", organic: null, organicPrev: undefined, organicUrl: null, maps: null, mapsPrev: undefined, checkedAt: null }); continue; }
    for (const loc of locs) {
      const at = (engine: string) => mine.filter((r) => r.location === loc && r.engine === engine); // newest first
      const o = at("organic"), m = at("maps");
      rows.push({
        id: k.id, keyword: k.keyword, location: loc,
        organic: o[0]?.position ?? null, organicPrev: o[1] ? o[1].position : undefined, organicUrl: o[0]?.url ?? null,
        maps: m[0]?.position ?? null, mapsPrev: m[1] ? m[1].position : undefined,
        checkedAt: o[0]?.checkedAt ?? m[0]?.checkedAt ?? null,
      });
    }
  }
  return rows;
}

/** Latest snapshot of ranking keywords, plus page-1 counts now and at the previous snapshot. */
export async function rankedSummary(clientId: string) {
  const days = await db.selectDistinct({ day: schema.rankedKeywords.day }).from(schema.rankedKeywords)
    .where(eq(schema.rankedKeywords.clientId, clientId)).orderBy(desc(schema.rankedKeywords.day)).limit(2);
  if (!days.length) return null;
  const load = (day: string) => db.select().from(schema.rankedKeywords)
    .where(and(eq(schema.rankedKeywords.clientId, clientId), eq(schema.rankedKeywords.day, day)));
  const now = await load(days[0].day);
  const prev = days[1] ? await load(days[1].day) : null;
  const count = (rows: typeof now, max: number) => rows.filter((r) => r.position <= max).length;
  const byVol = (a: (typeof now)[number], b: (typeof now)[number]) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || a.position - b.position;
  return {
    day: days[0].day, prevDay: days[1]?.day ?? null,
    top3: count(now, 3), page1: count(now, 10), page2: now.length - count(now, 10),
    prevTop3: prev ? count(prev, 3) : null, prevPage1: prev ? count(prev, 10) : null,
    page1Rows: now.filter((r) => r.position <= 10).sort(byVol),
    almostRows: now.filter((r) => r.position > 10).sort(byVol).slice(0, 25),
  };
}
