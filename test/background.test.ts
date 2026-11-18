import { describe, expect, it, vi } from "vitest";
const pending: Promise<unknown>[] = [];
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p) } }) }));
import { respondWithin, withRetry } from "@/lib/background";

describe("respondWithin", () => {
  it("answers 202 when the work is slow, and still finishes it in the background", async () => {
    let done = false;
    const slow = new Promise<Response>((r) => setTimeout(() => { done = true; r(Response.json({ ok: true })); }, 80));
    const res = await respondWithin(10, slow);
    expect(res.status).toBe(202);
    await Promise.all(pending);
    expect(done).toBe(true);
  });
  it("returns the real answer when the work is fast", async () => {
    expect((await respondWithin(500, Promise.resolve(new Response(null, { status: 401 })))).status).toBe(401);
  });
  it("retries a failing call", async () => {
    let n = 0;
    expect(await withRetry(async () => { if (++n < 2) throw new Error("cold"); return "ok"; })).toBe("ok");
  }, 10000);
});
