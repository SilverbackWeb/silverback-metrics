/** Home: Silverback team sees every client with tracking health; a client login goes straight to its dashboard. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { clientsFor, requireUser } from "@/lib/access";
import { currentMonth, monthLabel, monthRange } from "@/lib/reports";
import { Header } from "@/components/ui";

const TZ = "America/Chicago";

function ago(d: Date | null) {
  if (!d) return null;
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export default async function Home() {
  const user = await requireUser();
  const list = await clientsFor(user);
  if (!user.isAgency) {
    if (list.length === 1) redirect(`/c/${list[0].id}`);
  }
  const ym = currentMonth(TZ);
  const { start } = monthRange(ym, TZ);

  const counts = await db.select({ clientId: schema.leads.clientId, n: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(and(gte(schema.leads.createdAt, start), sql`${schema.leads.status} <> 'spam'`))
    .groupBy(schema.leads.clientId);
  const lastLead = await db.select({ clientId: schema.leads.clientId, at: sql<Date>`max(${schema.leads.createdAt})` })
    .from(schema.leads).groupBy(schema.leads.clientId);
  const sites = await db.select().from(schema.sites).orderBy(desc(schema.sites.lastSeenAt));

  const rows = list.map((c) => {
    const s = sites.filter((x) => x.clientId === c.id);
    const seen = s.map((x) => x.lastSeenAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
    const last = lastLead.find((x) => x.clientId === c.id)?.at ?? null;
    const health = !s.length ? "bad" : !seen || Date.now() - seen.getTime() > 864e5 ? "warn" : "good";
    return { c, leads: counts.find((x) => x.clientId === c.id)?.n ?? 0, seen, last: last ? new Date(last) : null, health, sites: s.length };
  });
  const col = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)" } as const;

  return (
    <>
      <Header title="Silverback Metrics" sub={user.isAgency ? "All clients" : "Your businesses"} initials="SB"
        right={user.isAgency ? <Link className="pill" href="/clients/new">+ New client</Link> : undefined} />
      <main className="gut"><div className="wrap view">
        <div><h1 className="vt">Clients</h1><p className="vsub">Leads in {monthLabel(ym)}, and whether each site's tracking is reporting in.</p></div>
        <section className="panel">
          {rows.length === 0 ? (
            <p className="empty">{user.isAgency ? <>No clients yet. <Link href="/clients/new">Add the first client</Link> to get its tracking code.</> : "Your account isn't linked to a business yet. Ask Silverback to add you."}</p>
          ) : (
            <div className="tbl"><table>
              <thead><tr><th>Client</th><th className="n">Leads this month</th><th className="hide-s">Last lead</th><th>Tracking</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.c.id} className="click">
                  <td className="who"><Link className="rowlink" href={`/c/${r.c.id}`}><b>{r.c.name}</b><span>{r.c.website ?? ""}</span></Link></td>
                  <td className="n"><b>{r.leads}</b></td>
                  <td className="hide-s">{ago(r.last) ?? "None yet"}</td>
                  <td><span className="ch"><i className="sw" style={{ background: col[r.health as keyof typeof col], borderRadius: "50%" }} />
                    {r.sites === 0 ? "No site added" : r.seen ? `Seen ${ago(r.seen)}` : "Snippet not seen yet"}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div></main>
    </>
  );
}
