/** Pieces shared by the SEO and Local & Maps tabs. Server components; forms call rank-actions. */
import type { TrackedRow } from "@/lib/seo";
import { scanStats, type latestScans } from "@/lib/heatmap";
import { city } from "@/lib/locations";
import { AutoRefresh } from "./AutoRefresh";
import { addKeywords, checkNow, removeKeyword, runHeatmapNow, saveLocations } from "@/app/c/[clientId]/rank-actions";

type Back = "seo" | "local";
export const path = (u: string | null) => { if (!u) return ""; try { return new URL(u).pathname; } catch { return u; } };
export const fmtN = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));
export const rankColor = (r: number | null) => (r === null ? "var(--bad)" : r <= 3 ? "var(--good)" : r <= 10 ? "var(--warn)" : "var(--bad)");

export function Pos({ now, prev, max }: { now: number | null; prev: number | null | undefined; max: number }) {
  const label = now === null ? `Not in top ${max}` : `#${now}`;
  let move: React.ReactNode = null;
  if (prev !== undefined) {
    const a = now ?? 999, b = prev ?? 999;
    if (a < b) move = <span className="up"> ▲ {prev === null ? "new" : b - a}</span>;
    else if (a > b) move = <span className="down"> ▼ {now === null ? "dropped" : a - b}</span>;
  }
  const tone = now === null ? "var(--muted)" : now <= 3 ? "var(--good)" : now <= 10 ? "var(--fg)" : "var(--warn)";
  return <><b style={{ color: tone, fontVariantNumeric: "tabular-nums" }}>{label}</b>{move}</>;
}

/** Tracked keywords, one row per keyword and area, showing Google or Maps position. */
export function TrackedTable({ rows, engine, clientId, back, isAgency, when }: {
  rows: TrackedRow[]; engine: "organic" | "maps"; clientId: string; back: Back; isAgency: boolean; when: Intl.DateTimeFormat;
}) {
  const multi = new Set(rows.map((t) => t.location)).size > 1;
  return (
    <div className="tbl"><table>
      <thead><tr><th>Keyword</th>{multi && <th>Area</th>}<th>{engine === "maps" ? "Google Maps" : "Google"}</th>{engine === "organic" && <th className="hide-s">Ranking page</th>}<th className="hide-s">Checked</th>{isAgency && <th></th>}</tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={6} className="empty">No keywords yet. {isAgency ? "Add 3 to 5 below." : "Silverback will add the searches we track for you."}</td></tr>}
        {rows.map((t, i) => {
          const first = rows[i - 1]?.id !== t.id;
          return (
            <tr key={`${t.id}-${t.location}`}>
              <td><b>{first ? t.keyword : ""}</b></td>
              {multi && <td>{city(t.location)}</td>}
              <td>{!t.checkedAt ? <span className="vsub">waiting for first check</span>
                : engine === "maps" ? <Pos now={t.maps} prev={t.mapsPrev} max={20} /> : <Pos now={t.organic} prev={t.organicPrev} max={30} />}</td>
              {engine === "organic" && <td className="hide-s">{path(t.organicUrl)}</td>}
              <td className="hide-s">{t.checkedAt ? when.format(t.checkedAt) : ""}</td>
              {isAgency && <td className="n">{first &&
                <form action={removeKeyword.bind(null, clientId, back, t.id)} style={{ display: "inline" }}><button className="pill" type="submit" aria-label={`Stop tracking ${t.keyword}`}>Remove</button></form>}</td>}
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}

const ERRORS: Record<string, string> = {
  max: "That's more than 10 keyword and area pairs. Remove one first.",
  wait: "Rankings were just checked. Try again in a few minutes.",
};

/** Team controls: add keywords, check now, and any error from the last check. */
export function KeywordControls({ clientId, back, error, e, connected, ready }: {
  clientId: string; back: Back; error: string | null; e?: string; connected: boolean; ready: boolean;
}) {
  return (<>
    {error && ready && <p className="err">Last check had a problem: {error}</p>}
    {e && ERRORS[e] && <p className="err">{ERRORS[e]}</p>}
    {!connected && <p className="err">DataForSEO isn&apos;t connected yet, so rankings can&apos;t be checked.</p>}
    <form action={addKeywords.bind(null, clientId, back)} className="filters">
      <input name="keywords" placeholder="electrician kirkwood mo, panel upgrade st louis" aria-label="Keywords to track" style={{ flex: "1 1 260px" }} />
      <button className="btn" type="submit">Add keywords</button>
      <button className="pill" type="submit" formAction={checkNow.bind(null, clientId, back)} disabled={!connected || !ready}>Check rankings now</button>
    </form>
  </>);
}

/** Where rankings are checked from. Shown first, as a step, until it's filled in. */
export function LocationsForm({ clientId, back, locations, gbpName, placeholderName, places, saved }: {
  clientId: string; back: Back; locations: string[]; gbpName: string | null; placeholderName: string;
  places: Record<string, { title: string | null }>; saved?: boolean;
}) {
  const empty = locations.length === 0;
  return (
    <section className="panel" style={empty ? { borderColor: "var(--accent-fill)" } : undefined}>
      <div className="ph"><h2>{empty ? "First, add your locations" : "Locations"}</h2><span>team only</span></div>
      {empty && <p style={{ margin: 0, fontSize: 14 }}>Rankings and heat maps are checked from each Google Business Profile location. Add one per line, like <b>Kirkwood, MO</b>.</p>}
      {saved && <p className="notice">Saved. Rankings for these locations are checked within the hour, or click Check rankings now.</p>}
      {!empty && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{locations.map((l) => (
          <li key={l}>{l.split(",").slice(0, 2).join(", ")} · {places[l]?.title ? <>Maps listing found: <b>{places[l].title}</b></> : <span className="vsub">listing not found yet</span>}</li>
        ))}</ul>
      )}
      <form action={saveLocations.bind(null, clientId, back)} style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13.5 }}>Locations (one per line, up to 3)
          <textarea name="locations" rows={2} defaultValue={locations.map((l) => l.split(",").slice(0, 2).join(", ")).join("\n")} placeholder={"Kirkwood, MO\nArnold, MO"}
            style={{ font: "inherit", padding: 8, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "inherit" }} /></label>
        <label className="field" style={{ display: "grid", gap: 4, fontSize: 13.5 }}>Business name as it shows on Google Maps
          <input name="gbpName" defaultValue={gbpName ?? ""} placeholder={placeholderName} /></label>
        <div><button className="btn" type="submit">Save locations</button></div>
      </form>
    </section>
  );
}

type Scan = Awaited<ReturnType<typeof latestScans>>[number];

export function HeatMap({ scans, selected, clientId, isAgency, canRun, e, when, hasPlaces }: {
  scans: Scan[]; selected: Scan | null; clientId: string; isAgency: boolean; canRun: boolean; e?: string; when: Intl.DateTimeFormat; hasPlaces: boolean;
}) {
  const scan = selected;
  const multi = new Set(scans.map((x) => x.location)).size > 1;
  return (
    <section className="panel" id="heatmap">
      <div className="ph"><h2>Google Maps heat map</h2><span>7×7 grid · 5 miles around the listing · monthly</span></div>
      {scans.length > 1 && (
        <div className="seg">{scans.map((s) => (
          <a key={s.id} className={`pill${s.id === scan?.id ? " on" : ""}`} href={`?hm=${s.id}#heatmap`}>{s.keyword}{multi ? ` · ${city(s.location)}` : ""}</a>
        ))}</div>
      )}
      {!scan ? (
        <p className="empty">{hasPlaces ? "The first heat map runs within the hour." : "The heat map starts once a rankings check finds the Google Business Profile listing for each location."}</p>
      ) : (() => {
        const st = scanStats(scan.points);
        const at = new Map(scan.points.map((p) => [`${p.row}:${p.col}`, p.rank]));
        const mid = (scan.gridSize - 1) / 2;
        const pending = scan.status !== "done" && scan.status !== "failed" && Date.now() - scan.createdAt.getTime() < 3 * 3600e3;
        return (<>
          {pending && <AutoRefresh seconds={15} />}
          <p className="vsub" style={{ margin: 0 }}><b>{scan.keyword}</b>{scan.location ? ` · around ${city(scan.location)}` : ""} · {when.format(scan.createdAt)}
            {scan.status !== "done" && scan.status !== "failed" && ` · ${scan.points.length} of ${scan.gridSize ** 2} points in so far (gray dots are still loading; this page updates by itself)`}
            {scan.status === "failed" && ` · failed: ${scan.error ?? "unknown error"}`}</p>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${scan.gridSize}, minmax(0, 44px))`, gap: 6, justifyContent: "center", padding: "8px 0" }} role="img"
            aria-label={`Heat map: average Maps position ${st.avg ?? "unknown"}, top 3 at ${st.top3}% of points`}>
            {Array.from({ length: scan.gridSize ** 2 }, (_, i) => {
              const r = Math.floor(i / scan.gridSize), c = i % scan.gridSize;
              const key = `${r}:${c}`, has = at.has(key), rank = at.get(key) ?? null;
              return <span key={key} title={has ? (rank ? `#${rank}` : "not in top 20") : "waiting"} style={{
                aspectRatio: "1", borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700,
                background: has ? rankColor(rank) : "var(--surface-2)", color: has ? "#fff" : "var(--muted)",
                outline: r === mid && c === mid ? "3px solid var(--fg)" : undefined, outlineOffset: 2,
              }}>{has ? (rank ?? "20+") : "·"}</span>;
            })}
          </div>
          <div className="kpis">
            <div className="kpi"><span className="l">Average Maps position</span><span className="v">{st.avg ?? "—"}</span><span className="d">across the grid (20+ counts as 21)</span></div>
            <div className="kpi"><span className="l">Top 3 coverage</span><span className="v">{st.top3}%</span><span className="d">of points show them in the top 3</span></div>
            <div className="kpi"><span className="l">Found in top 20</span><span className="v">{st.found}/{scan.points.length || scan.gridSize ** 2}</span><span className="d">points</span></div>
          </div>
          <p className="vsub" style={{ margin: 0, fontSize: 12.5 }}>Each dot is a Google Maps search from a spot about {(2 * scan.radiusMiles / (scan.gridSize - 1)).toFixed(1)} miles apart, north at the top; the outlined dot is the business. Green = top 3, yellow = 4 to 10, red = 11+ or not found.</p>
        </>);
      })()}
      {isAgency && (<>
        {e === "hmwait" && <p className="err">A heat map already ran in the last day.</p>}
        {e === "hmfail" && <p className="err">DataForSEO didn&apos;t accept the heat map. Check the connection and try again.</p>}
        {e === "hmqueued" && <p className="notice">Heat map started. Points fill in over the next few minutes; refresh to see them.</p>}
        {canRun && <form action={runHeatmapNow.bind(null, clientId)}><button className="pill" type="submit">Run heat map now</button></form>}
      </>)}
    </section>
  );
}
