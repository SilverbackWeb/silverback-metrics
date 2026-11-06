/**
 * Scheduled jobs, triggered by Cloudflare cron (see worker.ts).
 * Each run handles a batch of clients so it stays inside Worker limits.
 */
const JOBS = new Set(["nightly-sync", "monthly-heatmaps"]);

export async function POST(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const { job } = await ctx.params;
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!JOBS.has(job)) return new Response("unknown job", { status: 404 });

  // TODO(phase 2): nightly-sync -> Google Ads, GA4, Search Console, gclid lookups, backup-lead dedupe, event pruning.
  // TODO(phase 3): monthly-heatmaps -> queue DataForSEO tasks with a postback URL; results land in /api/ingest/dataforseo.
  return Response.json({ ok: true, job, note: "not implemented yet" });
}
