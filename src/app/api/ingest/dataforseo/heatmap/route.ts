/** DataForSEO postback for heat map points: /api/ingest/dataforseo/heatmap?scan=ID&token=SCAN_TOKEN */
import { savePoint } from "@/lib/heatmap";

async function readJson(req: Request) {
  const buf = new Uint8Array(await req.arrayBuffer());
  // DataForSEO gzips postbacks; decompress unless the platform already did.
  const raw = buf[0] === 0x1f && buf[1] === 0x8b
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : new TextDecoder().decode(buf);
  return JSON.parse(raw) as { tasks?: { status_code?: number; data?: { tag?: string }; result?: unknown[] | null }[] };
}

export async function POST(req: Request) {
  const u = new URL(req.url);
  const scan = u.searchParams.get("scan"), token = u.searchParams.get("token");
  if (!scan || !/^[0-9a-f-]{36}$/i.test(scan)) return new Response("bad scan", { status: 400 });
  let body;
  try { body = await readJson(req); } catch { return new Response("unreadable", { status: 400 }); }
  let ok = 0;
  for (const t of body.tasks ?? []) if (t.status_code === 20000 && (await savePoint(scan, token, t))) ok++;
  return Response.json({ ok: true, saved: ok });
}
