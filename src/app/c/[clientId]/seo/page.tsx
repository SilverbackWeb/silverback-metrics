/** SEO tab: the keywords we care about (Google + Maps position), and every keyword on page 1. */
import { notFound, redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireClient } from "@/lib/access";
import { hasDataForSeo } from "@/lib/dataforseo";
import { MAX_PAIRS, rankedSummary, runRankCheck, runRankedSnapshot, trackedTable } from "@/lib/seo";
import { ClientShell } from "@/components/ClientShell";

async function team(clientId: string) {
  const r = await requireClient(clientId);
  if (!r.user.isAgency) notFound();
  return r;
}

async function addKeywords(clientId: string, form: FormData) {
  "use server";
  const { client } = await team(clientId);
  const words = String(form.get("keywords") ?? "").split(/[\n,]/).map((s) => s.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.rankKeywords).where(eq(schema.rankKeywords.clientId, client.id));
  const locs = Math.max(1, client.rankLocations.length);
  const room = Math.floor(MAX_PAIRS / locs) - n;
  if (words.length > room) redirect(`/c/${clientId}/seo?e=max`);
  if (words.length) await db.insert(schema.rankKeywords).values(words.map((keyword) => ({ clientId: client.id, keyword }))).onConflictDoNothing();
  redirect(`/c/${clientId}/seo`);
}

async function removeKeyword(clientId: string, keywordId: string) {
  "use server";
  const { client } = await team(clientId);
  await db.delete(schema.rankKeywords).where(and(eq(schema.rankKeywords.id, keywordId), eq(schema.rankKeywords.clientId, client.id)));
  redirect(`/c/${clientId}/seo`);
}

async function saveSettings(clientId: string, form: FormData) {
  "use server";
  const { client } = await team(clientId);
  const locs = String(form.get("locations") ?? "").split("\n").map((s) => s.trim().replace(/\s*,\s*/g, ",")).filter(Boolean).slice(0, 3);
  await db.update(schema.clients).set({ rankLocations: locs, gbpName: String(form.get("gbpName") ?? "").trim() || null }).where(eq(schema.clients.id, client.id));
  redirect(`/c/${clientId}/seo`);
}

async function checkNow(clientId: string) {
  "use server";
  const { client } = await team(clientId);
  // At most once every 10 minutes, so a double-click can't run up the DataForSEO bill.
  if (client.rankCheckedAt && Date.now() - client.rankCheckedAt.getTime() < 10 * 60e3) redirect(`/c/${clientId}/seo?e=wait`);
  await Promise.all([runRankCheck(client.id), runRankedSnapshot(client.id)]);
  redirect(`/c/${clientId}/seo`);
}

function Pos({ now, prev }: { now: number | null; prev: number | null | undefined }) {
  const label = now === null ? "Not in top 20+" : `#${now}`;
  let move: React.ReactNode = null;
  if (prev !== undefined) {
    const a = now ?? 99, b = prev ?? 99;
    if (a < b) move = <span className="up"> ▲ {prev === null ? "new" : b - a}</span>;
    else if (a > b) move = <span className="down"> ▼ {now === null ? "dropped" : a - b}</span>;
  }
  const tone = now === null ? "var(--muted)" : now <= 3 ? "var(--good)" : now <= 10 ? "var(--fg)" : "var(--warn)";
  return <><b style={{ color: tone, fontVariantNumeric: "tabular-nums" }}>{label}</b>{move}</>;
}

const path = (u: string | null) => { if (!u) return ""; try { return new URL(u).pathname; } catch { return u; } };
const fmtN = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));
const city = (loc: string) => loc.split(",")[0];

export default async function Seo({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ e?: string }> }) {
  const { clientId } = await params;
  const { e } = await searchParams;
  const { client, user } = await requireClient(clientId);
  const [tracked, ranked] = await Promise.all([trackedTable(client.id), rankedSummary(client.id)]);
  const kwCount = new Set(tracked.map((t) => t.id)).size;
  const when = new Intl.DateTimeFormat("en-US", { timeZone: client.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const lastChecked = tracked.map((t) => t.checkedAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
  const connected = hasDataForSeo();
  const multiLoc = new Set(tracked.map((t) => t.location)).size > 1;

  return (
    <ClientShell client={client} active="seo" isAgency={user.isAgency}>
      <div><h1 className="vt">Search rankings</h1>
        <p className="vsub">Where {client.name} shows up on Google and Google Maps for the searches that matter most.</p></div>

      {ranked && (
        <div className="kpis">
          <div className="kpi"><span className="l">Keywords in the top 3</span><span className="v">{ranked.top3}</span>
            <span className="d">{ranked.prevTop3 == null ? "first check" : `${ranked.top3 - ranked.prevTop3 >= 0 ? "+" : ""}${ranked.top3 - ranked.prevTop3} since last month`}</span></div>
          <div className="kpi"><span className="l">On page 1 of Google</span><span className="v">{ranked.page1}</span>
            <span className="d">{ranked.prevPage1 == null ? "first check" : `${ranked.page1 - ranked.prevPage1 >= 0 ? "+" : ""}${ranked.page1 - ranked.prevPage1} since last month`}</span></div>
          <div className="kpi"><span className="l">Almost there (page 2)</span><span className="v">{ranked.page2}</span><span className="d">positions 11 to 20</span></div>
          <div className="kpi"><span className="l">Tracked keywords</span><span className="v">{kwCount}</span><span className="d">{lastChecked ? `checked ${when.format(lastChecked)}` : "not checked yet"}</span></div>
        </div>
      )}

      <section className="panel">
        <div className="ph"><h2>Keywords we&apos;re tracking</h2><span>{lastChecked ? `last checked ${when.format(lastChecked)} · checked every week` : "checked every week"}</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Keyword</th>{multiLoc && <th>Area</th>}<th>Google</th><th>Google Maps</th><th className="hide-s">Ranking page</th>{user.isAgency && <th></th>}</tr></thead>
          <tbody>
            {tracked.length === 0 && <tr><td colSpan={6} className="empty">No keywords yet. {user.isAgency ? "Add 3 to 5 below." : "Silverback will add the searches we track for you."}</td></tr>}
            {tracked.map((t, i) => (
              <tr key={`${t.id}-${t.location}`}>
                <td><b>{tracked[i - 1]?.id === t.id ? "" : t.keyword}</b></td>
                {multiLoc && <td>{city(t.location)}</td>}
                <td>{t.checkedAt ? <Pos now={t.organic} prev={t.organicPrev} /> : <span className="vsub">waiting for first check</span>}</td>
                <td>{t.checkedAt ? <Pos now={t.maps} prev={t.mapsPrev} /> : ""}</td>
                <td className="hide-s">{path(t.organicUrl)}</td>
                {user.isAgency && <td className="n">{tracked[i - 1]?.id === t.id ? null :
                  <form action={removeKeyword.bind(null, client.id, t.id)} style={{ display: "inline" }}><button className="pill" type="submit" aria-label={`Stop tracking ${t.keyword}`}>Remove</button></form>}</td>}
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="vsub" style={{ margin: 0, fontSize: 12.5 }}>Google = regular results (we check the first 3 pages). Google Maps = the map listings (top 20). ▲ ▼ show the change since the previous check.</p>

        {user.isAgency && (<>
          {client.rankCheckError && <p className="err">Last check had a problem: {client.rankCheckError}</p>}
          {e === "max" && <p className="err">That&apos;s more than {MAX_PAIRS} keyword and area pairs. Remove one first.</p>}
          {e === "wait" && <p className="err">Rankings were just checked. Try again in a few minutes.</p>}
          {!connected && <p className="err">DataForSEO isn&apos;t connected yet, so rankings can&apos;t be checked.</p>}
          <form action={addKeywords.bind(null, client.id)} className="filters">
            <input name="keywords" placeholder="electrician kirkwood mo, panel upgrade st louis" aria-label="Keywords to track" style={{ flex: "1 1 260px" }} />
            <button className="btn" type="submit">Add keywords</button>
          </form>
          <form action={checkNow.bind(null, client.id)}><button className="pill" type="submit" disabled={!connected}>Check rankings now</button></form>
        </>)}
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
          <div className="tbl"><table>
            <tbody>{ranked.almostRows.map((r) => <tr key={r.keyword}><td>{r.keyword}</td><td className="n">#{r.position}</td><td className="n hide-s">{fmtN(r.searchVolume)}</td><td className="hide-s">{path(r.url)}</td></tr>)}</tbody>
          </table></div>
        </>)}
        <p className="vsub" style={{ margin: 0, fontSize: 12.5 }}>From DataForSEO&apos;s nationwide Google data, refreshed monthly. Local results can differ; the tracked keywords above are checked from your service area.</p>
      </section>

      {user.isAgency && (
        <section className="panel">
          <div className="ph"><h2>Ranking settings</h2><span>team only</span></div>
          <form action={saveSettings.bind(null, client.id)} className="view" style={{ gap: 10 }}>
            <label className="field" style={{ display: "grid", gap: 4, fontSize: 13.5 }}>Check from these areas (one per line, up to 3, as City,State,Country)
              <textarea name="locations" rows={3} defaultValue={client.rankLocations.join("\n")} placeholder={"Kirkwood,Missouri,United States\nArnold,Missouri,United States"}
                style={{ font: "inherit", padding: 8, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)" }} /></label>
            <label className="field" style={{ display: "grid", gap: 4, fontSize: 13.5 }}>Business name on Google Maps (used to find the listing)
              <input name="gbpName" defaultValue={client.gbpName ?? ""} placeholder={client.name} /></label>
            <div><button className="btn" type="submit">Save settings</button></div>
          </form>
        </section>
      )}
    </ClientShell>
  );
}
