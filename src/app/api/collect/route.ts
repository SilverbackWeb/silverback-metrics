/**
 * Beacon endpoint for public/t.js. Body is JSON sent as text/plain (no CORS preflight).
 * Always answers 204 so a bad request never breaks the client's site.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordTouch, siteByKey } from "@/lib/touches";
import type { Touch } from "@/lib/attribution";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(["pageview", "tel_click", "form_submit", "field_found"]);

type Beacon = {
  k?: string; type?: string; vid?: string; sid?: string; url?: string; title?: string;
  ga?: string | null; touch?: Touch | null; ft?: Touch | null; data?: unknown;
};

const noContent = () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });

export async function POST(req: Request) {
  let b: Beacon;
  try {
    const text = await req.text();
    if (text.length > 64_000) return noContent();
    b = JSON.parse(text);
  } catch {
    return noContent();
  }
  if (!b.k || !b.vid || !UUID.test(b.vid) || !b.type || !TYPES.has(b.type)) return noContent();

  const site = await siteByKey(b.k);
  if (!site) return noContent();

  // Optional: reject beacons from domains that aren't this site's.
  const origin = req.headers.get("origin");
  if (origin && !hostMatches(origin, site.domain)) return noContent();

  if (b.type === "pageview" && b.touch) {
    await recordTouch(site.id, b.vid, b.touch, { isFirst: !!b.ft, gaClientId: b.ga });
  }

  await db.insert(schema.events).values({
    siteId: site.id,
    visitorId: b.vid,
    sessionId: b.sid && UUID.test(b.sid) ? b.sid : null,
    type: b.type,
    url: b.url?.slice(0, 2000),
    title: b.title?.slice(0, 300),
    data: b.data ?? null,
  });

  const now = new Date();
  await db.update(schema.sites)
    .set(b.type === "field_found" ? { lastSeenAt: now, lastFieldSeenAt: now } : { lastSeenAt: now })
    .where(eq(schema.sites.id, site.id));

  // TODO(phase 1): form_submit backups become leads after a delay if no webhook lead
  // arrives for the same visitor (dedupe window ~2 minutes). Handled by a pg-boss job.

  return noContent();
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" },
  });
}

function hostMatches(origin: string, domain: string) {
  try {
    const h = new URL(origin).hostname.replace(/^www\./, "");
    const d = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    return h === d || h.endsWith("." + d) || h === "localhost";
  } catch {
    return false;
  }
}
