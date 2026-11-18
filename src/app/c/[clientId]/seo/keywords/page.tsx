/** Every keyword the site ranks for in Google's top 100: sortable, filterable, downloadable. */
import Link from "next/link";
import { requireClient } from "@/lib/access";
import { allKeywords, type KeywordRow } from "@/lib/seo";
import { FILTERS, SORTS, filterSort, type Filter, type Sort } from "@/lib/keyword-table";
import { ClientShell } from "@/components/ClientShell";
import { fmtN, path } from "@/components/Rankings";

function Change({ r }: { r: KeywordRow }) {
  if (r.prev === undefined) return <span className="vsub">—</span>;
  if (r.position === null) return <span className="down">dropped from #{r.prev}</span>;
  if (r.prev === null) return <span className="up">new</span>;
  const c = r.change ?? 0;
  return c > 0 ? <span className="up">▲ {c}</span> : c < 0 ? <span className="down">▼ {-c}</span> : <span className="vsub">–</span>;
}

export default async function AllKeywords({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ f?: string; sort?: string; q?: string }> }) {
  const { clientId } = await params;
  const sp = await searchParams;
  const { client, user } = await requireClient(clientId);
  const data = await allKeywords(client.id);
  const f = (sp.f && sp.f in FILTERS ? sp.f : "all") as Filter;
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "volume") as Sort;
  const q = (sp.q ?? "").trim();
  const base = `/c/${client.id}/seo/keywords`;
  const link = (o: Partial<{ f: string; sort: string; q: string }>) => {
    const u = new URLSearchParams({ ...(f !== "all" ? { f } : {}), ...(sort !== "volume" ? { sort } : {}), ...(q ? { q } : {}), ...o });
    for (const [k, v] of [...u.entries()]) if (!v || (k === "f" && v === "all") || (k === "sort" && v === "volume")) u.delete(k);
    return `${base}${u.size ? `?${u}` : ""}`;
  };
  const rows = data ? filterSort(data.rows, data.lost, f, sort, q) : [];
  const count = (ff: Filter) => (data ? filterSort(data.rows, data.lost, ff, "volume", "").length : 0);

  return (
    <ClientShell client={client} active="seo" isAgency={user.isAgency}>
      <div><p className="vsub" style={{ margin: 0 }}><Link href={`/c/${client.id}/seo`}>← SEO</Link></p>
        <h1 className="vt">All ranking keywords</h1>
        <p className="vsub">Every search where {client.name} shows up in Google&apos;s top 100{data ? `, as of ${data.day}` : ""}.{data?.prevDay ? ` Change is since ${data.prevDay}.` : data ? " Change shows from the next monthly report." : ""}</p></div>
      {!data ? <section className="panel"><p className="empty">The first keyword report appears after the first rankings check.</p></section> : (
        <section className="panel">
          <div className="seg">{(Object.keys(FILTERS) as Filter[]).filter((k) => k === "all" || count(k) > 0).map((k) =>
            <Link key={k} className={`pill${f === k ? " on" : ""}`} href={link({ f: k })}>{FILTERS[k]} · {k === "all" ? data.rows.length : count(k)}</Link>)}</div>
          <form className="filters" action={base}>
            {f !== "all" && <input type="hidden" name="f" value={f} />}
            {sort !== "volume" && <input type="hidden" name="sort" value={sort} />}
            <input type="search" name="q" defaultValue={q} placeholder="Find a keyword" aria-label="Find a keyword" />
            <button className="pill" type="submit">Search</button>
            <a className="pill" href={`/c/${client.id}/seo/keywords.csv`} download>Download CSV</a>
          </form>
          <div className="tbl"><table>
            <thead><tr>
              {(["keyword", "position", "change", "volume", "traffic"] as Sort[]).map((k) => (
                <th key={k} className={k === "keyword" ? undefined : `n${k === "traffic" ? " hide-s" : ""}`} aria-sort={sort === k ? "descending" : undefined}>
                  <Link href={link({ sort: k })} style={{ color: "inherit", textDecoration: sort === k ? "underline" : "none" }}>{SORTS[k]}{sort === k ? " ↓" : ""}</Link></th>))}
              <th className="hide-s">Page</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="empty">No keywords match.</td></tr>}
              {rows.map((r) => (
                <tr key={r.keyword}>
                  <td>{r.keyword}</td>
                  <td className="n"><b>{r.position ? `#${r.position}` : "—"}</b></td>
                  <td className="n"><Change r={r} /></td>
                  <td className="n">{fmtN(r.searchVolume)}</td>
                  <td className="n hide-s">{r.etv != null ? Math.round(r.etv).toLocaleString("en-US") : "—"}</td>
                  <td className="hide-s">{path(r.url)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="vsub" style={{ margin: 0, fontSize: 12.5 }}>Searches = average monthly Google searches in the US. Est. visits = DataForSEO&apos;s estimate of monthly clicks from that position. Refreshed monthly.</p>
        </section>
      )}
    </ClientShell>
  );
}
