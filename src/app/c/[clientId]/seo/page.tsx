/** SEO: Google Search Console traffic, the tracked keywords' Google positions, and every keyword on page 1. */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireClient } from "@/lib/access";
import { hasDataForSeo } from "@/lib/dataforseo";
import { rankedSummary, trackedTable } from "@/lib/seo";
import { leadsInMonth, resolveMonth } from "@/lib/queries";
import { monthLabel, summarize } from "@/lib/reports";
import { ClientShell } from "@/components/ClientShell";
import { KeywordControls, LocationsForm, TrackedTable, fmtN, path } from "@/components/Rankings";

async function gscByMonth(clientId: string) {
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - 6); since.setUTCDate(1);
  return db.select({
    month: sql<string>`to_char(${schema.gscDaily.day}, 'YYYY-MM')`,
    clicks: sql<number>`sum(${schema.gscDaily.clicks})::int`,
    impressions: sql<number>`sum(${schema.gscDaily.impressions})::int`,
  }).from(schema.gscDaily).where(and(eq(schema.gscDaily.clientId, clientId), gte(schema.gscDaily.day, since.toISOString().slice(0, 10))))
    .groupBy(sql`1`).orderBy(sql`1`);
}

function ClicksChart({ rows }: { rows: { month: string; clicks: number }[] }) {
  const W = 520, H = 150, pl = 40, pb = 22;
  const max = Math.max(10, ...rows.map((r) => r.clicks));
  const x = (i: number) => pl + (rows.length > 1 ? (i * (W - pl - 10)) / (rows.length - 1) : (W - pl) / 2);
  const y = (v: number) => H - pb - (v / max) * (H - pb - 8);
  const line = rows.map((r, i) => `${i ? "L" : "M"}${x(i)} ${y(r.clicks)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly clicks from Google search">
      {[0, max / 2, max].map((v) => <g key={v}><line x1={pl} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={pl - 6} y={y(v) + 4} fontSize="11" textAnchor="end" fill="var(--muted)">{Math.round(v)}</text></g>)}
      {rows.length > 1 && <path d={`${line} L${x(rows.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="var(--accent-soft)" />}
      <path d={line} fill="none" stroke="var(--accent-fill)" strokeWidth="2.5" />
      {rows.map((r, i) => <text key={r.month} x={x(i)} y={H - 5} fontSize="11" textAnchor="middle" fill="var(--muted)">{monthLabel(r.month).slice(0, 3)}</text>)}
    </svg>
  );
}

export default async function Seo({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ e?: string; saved?: string }> }) {
  const { clientId } = await params;
  const { e, saved } = await searchParams;
  const { client, user } = await requireClient(clientId);
  const mo = resolveMonth(undefined, client.timezone);
  const [tracked, ranked, gsc, leads, top] = await Promise.all([trackedTable(client.id), rankedSummary(client.id), gscByMonth(client.id),
    leadsInMonth(client.id, mo.ym, client.timezone), db.select().from(schema.gscTop).where(eq(schema.gscTop.clientId, client.id))]);
  const topQ = top.filter((t) => t.kind === "query").sort((a, b) => b.clicks - a.clicks).slice(0, 15);
  const topP = top.filter((t) => t.kind === "page").sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  const when = new Intl.DateTimeFormat("en-US", { timeZone: client.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const organic = summarize(leads.filter((l) => l.channel === "organic_search")).leads;
  const ready = client.rankLocations.length > 0;
  const last = gsc[gsc.length - 1], prev = gsc[gsc.length - 2];
  const change = last && prev && prev.clicks ? Math.round(((last.clicks - prev.clicks) / prev.clicks) * 100) : null;

  return (
    <ClientShell client={client} active="seo" isAgency={user.isAgency}>
      <div><h1 className="vt">SEO</h1><p className="vsub">Clicks from Google search, the keywords we track, and every search {client.name} is on page 1 for.</p></div>

      <div className="cols even">
        <section className="panel"><div className="ph"><h2>Clicks from Google search</h2>
          <span>{last ? `${fmtN(last.clicks)} in ${monthLabel(last.month).split(" ")[0]}${change !== null ? `, ${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}%` : ""}` : "Search Console"}</span></div>
          {gsc.length ? <ClicksChart rows={gsc} /> : <p className="empty">Search Console isn&apos;t connected for this client yet. Clicks, impressions and top searches show here once it is.</p>}
        </section>
        <section className="panel"><div className="ph"><h2>Organic leads</h2><span>found you on Google, not an ad</span></div>
          <div className="kpi" style={{ border: 0, padding: 0 }}><span className="v">{organic}</span><span className="d">calls and forms from Google search in {monthLabel(mo.ym).split(" ")[0]}</span></div>
        </section>
      </div>

      {top.length > 0 && (
        <div className="cols even">
          <section className="panel"><div className="ph"><h2>Top searches</h2><span>last 28 days · Search Console</span></div>
            <div className="tbl"><table><thead><tr><th>Search</th><th className="n">Clicks</th><th className="n hide-s">Impr.</th><th className="n">Avg pos.</th></tr></thead>
              <tbody>{topQ.map((r) => <tr key={r.key}><td>{r.key}</td><td className="n">{fmtN(r.clicks)}</td><td className="n hide-s">{fmtN(r.impressions)}</td><td className="n">{r.position?.toFixed(1) ?? "—"}</td></tr>)}</tbody></table></div>
          </section>
          <section className="panel"><div className="ph"><h2>Top pages</h2><span>last 28 days</span></div>
            <div className="tbl"><table><thead><tr><th>Page</th><th className="n">Clicks</th><th className="n hide-s">Impr.</th></tr></thead>
              <tbody>{topP.map((r) => <tr key={r.key}><td>{path(r.key) || r.key}</td><td className="n">{fmtN(r.clicks)}</td><td className="n hide-s">{fmtN(r.impressions)}</td></tr>)}</tbody></table></div>
          </section>
        </div>
      )}

      {ranked && (
        <div className="kpis">
          <div className="kpi"><span className="l">Keywords in the top 3</span><span className="v">{ranked.top3}</span>
            <span className="d">{ranked.prevTop3 == null ? "first report" : `${ranked.top3 - ranked.prevTop3 >= 0 ? "+" : ""}${ranked.top3 - ranked.prevTop3} since last month`}</span></div>
          <div className="kpi"><span className="l">On page 1 of Google</span><span className="v">{ranked.page1}</span>
            <span className="d">{ranked.prevPage1 == null ? "first report" : `${ranked.page1 - ranked.prevPage1 >= 0 ? "+" : ""}${ranked.page1 - ranked.prevPage1} since last month`}</span></div>
          <div className="kpi"><span className="l">Almost there (page 2)</span><span className="v">{ranked.page2}</span><span className="d">positions 11 to 20</span></div>
          <div className="kpi"><span className="l">Tracked keywords</span><span className="v">{new Set(tracked.map((t) => t.id)).size}</span><span className="d">checked every week</span></div>
        </div>
      )}

      {!ready && user.isAgency && <LocationsForm clientId={client.id} back="seo" locations={client.rankLocations} gbpName={client.gbpName} placeholderName={client.name} places={client.gbpPlaces} saved={saved === "1"} />}
      <section className="panel">
        <div className="ph"><h2>Keywords we&apos;re tracking</h2><span>Google position from each location · first 3 pages</span></div>
        <TrackedTable rows={tracked} engine="organic" clientId={client.id} back="seo" isAgency={user.isAgency} when={when} />
        {user.isAgency && <KeywordControls clientId={client.id} back="seo" error={client.rankCheckError} e={e} connected={hasDataForSeo()} ready={ready} />}
      </section>

      <section className="panel">
        <div className="ph"><h2>Keywords on page 1 of Google</h2><span>{ranked ? `${ranked.page1} keywords · as of ${ranked.day}` : "monthly"}</span></div>
        {!ranked ? <p className="empty">The first report appears after the first rankings check.</p> : (
          <div className="tbl"><table>
            <thead><tr><th>Keyword</th><th className="n">Position</th><th className="n hide-s">Searches / mo</th><th className="hide-s">Page</th></tr></thead>
            <tbody>
              {ranked.page1Rows.length === 0 && <tr><td colSpan={4} className="empty">No page 1 keywords yet.</td></tr>}
              {ranked.page1Rows.map((r) => <tr key={r.keyword}><td>{r.keyword}</td><td className="n">#{r.position}</td><td className="n hide-s">{fmtN(r.searchVolume)}</td><td className="hide-s">{path(r.url)}</td></tr>)}
            </tbody>
          </table></div>
        )}
        {ranked && ranked.almostRows.length > 0 && (<>
          <p className="sect" style={{ marginTop: 8 }}>Almost there · page 2</p>
          <div className="tbl"><table><tbody>{ranked.almostRows.map((r) => <tr key={r.keyword}><td>{r.keyword}</td><td className="n">#{r.position}</td><td className="n hide-s">{fmtN(r.searchVolume)}</td><td className="hide-s">{path(r.url)}</td></tr>)}</tbody></table></div>
        </>)}
        <p className="vsub" style={{ margin: 0, fontSize: 12.5 }}>From DataForSEO&apos;s nationwide Google data, refreshed monthly. The tracked keywords above are checked from each location.</p>
      </section>
    </ClientShell>
  );
}
