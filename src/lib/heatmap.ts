/**
 * Local heat maps: a grid of points around the client's Google Business Profile listing.
 * For each point we ask DataForSEO (standard queue, cheaper than live) where the listing ranks
 * in Google Maps for a searcher standing there. Results come back one point at a time to
 * /api/ingest/dataforseo/heatmap, so no request ever waits on DataForSEO.
 */
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { randomToken } from "./password";
import { MAPS_DEPTH, findMaps } from "./dataforseo";
import { clientDomain } from "./seo";

export const GRID = 7;
export const RADIUS_MILES = 5;
const DAY = 864e5;

/** n x n points spaced evenly across a square 2r miles wide, centered on the listing. */
export function gridPoints(lat: number, lng: number, n = GRID, radiusMiles = RADIUS_MILES) {
  const step = n > 1 ? (2 * radiusMiles) / (n - 1) : 0;
  const dLat = step / 69.0;
  const dLng = step / (69.0 * Math.cos((lat * Math.PI) / 180));
  const half = (n - 1) / 2;
  const pts: { row: number; col: number; lat: number; lng: number }[] = [];
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    pts.push({ row, col, lat: +(lat + (half - row) * dLat).toFixed(6), lng: +(lng + (col - half) * dLng).toFixed(6) });
  }
  return pts;
}

async function postTasks(tasks: object[]) {
  const login = process.env.DATAFORSEO_LOGIN, pw = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pw) throw new Error("DataForSEO isn't connected yet.");
  for (let i = 0; i < tasks.length; i += 100) {
    const res = await fetch("https://api.dataforseo.com/v3/serp/google/maps/task_post", {
      method: "POST",
      headers: { authorization: `Basic ${btoa(`${login}:${pw}`)}`, "content-type": "application/json" },
      body: JSON.stringify(tasks.slice(i, i + 100)),
    });
    if (!res.ok) throw new Error(`DataForSEO task_post: HTTP ${res.status}`);
    const body = await res.json() as { tasks?: { status_code: number; status_message: string }[] };
    const bad = body.tasks?.find((t) => t.status_code !== 20100);
    if (bad) throw new Error(`DataForSEO task_post: ${bad.status_message}`);
  }
}

/** Queue a scan of every tracked Maps keyword, for every location whose listing we know. */
export async function queueHeatmaps(clientId: string, baseUrl: string) {
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).limit(1);
  if (!client) return 0;
  const kws = await db.select().from(schema.rankKeywords).where(and(eq(schema.rankKeywords.clientId, client.id), eq(schema.rankKeywords.trackMaps, true)));
  const places = Object.entries(client.gbpPlaces).filter(([loc]) => client.rankLocations.includes(loc));
  if (!kws.length || !places.length) return 0;

  const scans = await db.insert(schema.heatmapScans).values(kws.flatMap((k) => places.map(([loc, p]) => ({
    clientId: client.id, keywordId: k.id, location: loc, centerLat: p.lat, centerLng: p.lng,
    gridSize: GRID, radiusMiles: RADIUS_MILES, targetCid: p.cid, token: randomToken(), status: "queued",
  })))).returning();

  const kwById = new Map(kws.map((k) => [k.id, k.keyword]));
  const tasks = scans.flatMap((s) => gridPoints(s.centerLat, s.centerLng, s.gridSize, s.radiusMiles).map((pt) => ({
    keyword: kwById.get(s.keywordId), language_code: "en", depth: MAPS_DEPTH,
    location_coordinate: `${pt.lat},${pt.lng},13z`,
    tag: `${pt.row}:${pt.col}:${pt.lat}:${pt.lng}`,
    postback_url: `${baseUrl}/api/ingest/dataforseo/heatmap?scan=${s.id}&token=${s.token}`,
    postback_data: "advanced",
  })));
  try {
    await postTasks(tasks);
  } catch (e) {
    await db.update(schema.heatmapScans).set({ status: "failed", error: (e as Error).message.slice(0, 300) }).where(inArray(schema.heatmapScans.id, scans.map((s) => s.id)));
    throw e;
  }
  return scans.length;
}

/** Save one grid point from a DataForSEO postback; mark the scan done when every point is in. */
export async function savePoint(scanId: string, token: string | null, task: { data?: { tag?: string }; result?: unknown[] | null }) {
  const [scan] = await db.select().from(schema.heatmapScans).where(eq(schema.heatmapScans.id, scanId)).limit(1);
  if (!scan || !token || scan.token !== token) return false;
  const [row, col, lat, lng] = String(task.data?.tag ?? "").split(":").map(Number);
  if ([row, col, lat, lng].some((v) => Number.isNaN(v))) return false;
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, scan.clientId)).limit(1);
  const domain = (await clientDomain(scan.clientId, client?.website ?? null)) ?? "";
  const hit = findMaps((task.result?.[0] ?? {}) as Record<string, unknown>, domain, client?.gbpName ?? null, scan.targetCid);
  await db.insert(schema.heatmapPoints).values({ scanId, row, col, lat, lng, rank: hit.position })
    .onConflictDoUpdate({ target: [schema.heatmapPoints.scanId, schema.heatmapPoints.row, schema.heatmapPoints.col], set: { rank: hit.position } });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.heatmapPoints).where(eq(schema.heatmapPoints.scanId, scanId));
  if (n >= scan.gridSize * scan.gridSize) await db.update(schema.heatmapScans).set({ status: "done" }).where(eq(schema.heatmapScans.id, scanId));
  return true;
}

/** Hourly: queue one client whose heat maps are 28+ days old (monthly by default). */
export async function heatmapsDue(baseUrl: string) {
  const recent = sql`exists (select 1 from ${schema.heatmapScans} where ${schema.heatmapScans.clientId} = ${schema.clients.id} and ${schema.heatmapScans.createdAt} > ${new Date(Date.now() - 28 * DAY)})`;
  const hasKw = sql`exists (select 1 from ${schema.rankKeywords} where ${schema.rankKeywords.clientId} = ${schema.clients.id})`;
  const [due] = await db.select({ id: schema.clients.id }).from(schema.clients)
    .where(and(hasKw, sql`${schema.clients.gbpPlaces} <> '{}'::jsonb`, sql`not ${recent}`)).limit(1);
  if (!due) return null;
  try { await queueHeatmaps(due.id, baseUrl); } catch (e) { console.error("heat map queue failed", e); }
  return due.id;
}

/** Latest scan per keyword + location, with its points and the scan before it (for "average rank was"). */
export async function latestScans(clientId: string) {
  const scans = await db.select().from(schema.heatmapScans)
    .where(and(eq(schema.heatmapScans.clientId, clientId), gt(schema.heatmapScans.createdAt, new Date(Date.now() - 400 * DAY))))
    .orderBy(desc(schema.heatmapScans.createdAt));
  const kws = await db.select().from(schema.rankKeywords).where(eq(schema.rankKeywords.clientId, clientId));
  const name = new Map(kws.map((k) => [k.id, k.keyword]));
  const seen = new Set<string>();
  const latest = scans.filter((s) => name.has(s.keywordId) && !seen.has(`${s.keywordId}|${s.location}`) && seen.add(`${s.keywordId}|${s.location}`));
  const points = latest.length ? await db.select().from(schema.heatmapPoints).where(inArray(schema.heatmapPoints.scanId, latest.map((s) => s.id))) : [];
  return latest.map((s) => ({ ...s, keyword: name.get(s.keywordId)!, points: points.filter((p) => p.scanId === s.id) }));
}

export function scanStats(points: { rank: number | null }[]) {
  if (!points.length) return { avg: null as number | null, top3: 0, found: 0 };
  const ranks = points.map((p) => p.rank ?? 21);
  return {
    avg: +(ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1),
    top3: Math.round((points.filter((p) => p.rank !== null && p.rank <= 3).length / points.length) * 100),
    found: points.filter((p) => p.rank !== null).length,
  };
}
