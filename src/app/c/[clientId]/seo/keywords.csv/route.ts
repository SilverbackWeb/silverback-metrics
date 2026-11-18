/** CSV download of every ranking keyword (same access rules as the page). */
import { requireClient } from "@/lib/access";
import { allKeywords } from "@/lib/seo";

const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  const { client } = await requireClient(clientId);
  const data = await allKeywords(client.id);
  const lines = [["keyword", "position", "previous_position", "change", "monthly_searches", "est_monthly_visits", "url"].join(",")];
  for (const r of [...(data?.rows ?? []), ...(data?.lost ?? [])].sort((a, b) => (a.position ?? 999) - (b.position ?? 999))) {
    lines.push([r.keyword, r.position, r.prev ?? "", r.change ?? "", r.searchVolume, r.etv != null ? Math.round(r.etv) : "", r.url].map(cell).join(","));
  }
  const name = `${client.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-keywords-${data?.day ?? "none"}.csv`;
  return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
}
