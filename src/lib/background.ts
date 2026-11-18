/**
 * Webhook senders (CallRail, Elementor) give up after a few seconds and often don't retry.
 * When the database is waking up (Neon free tier sleeps after 5 idle minutes), saving can take longer.
 * So: answer within `ms`. If the work isn't done by then, reply 202 and let the Worker finish it
 * in the background (Cloudflare's waitUntil), retrying once if the database errors.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      console.error(`attempt ${i + 1} failed`, e);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

export async function respondWithin(ms: number, work: Promise<Response>): Promise<Response> {
  const guarded = work.catch((e) => {
    console.error("webhook failed", e);
    return Response.json({ ok: false, error: "server error" }, { status: 500 });
  });
  let waitUntil: ((p: Promise<unknown>) => void) | null = null;
  try { waitUntil = getCloudflareContext().ctx.waitUntil.bind(getCloudflareContext().ctx); } catch { /* not on Workers (tests, local dev) */ }
  if (!waitUntil) return guarded;
  waitUntil(guarded);
  const timer = new Promise<Response>((r) => setTimeout(() => r(Response.json({ ok: true, queued: true }, { status: 202 })), ms));
  return Promise.race([guarded, timer]);
}
