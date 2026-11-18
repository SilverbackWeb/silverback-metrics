import Link from "next/link";
import { requireClient } from "@/lib/access";
import { leadsInMonth, resolveMonth } from "@/lib/queries";
import { CHANNEL_ORDER, money, monthLabel } from "@/lib/reports";
import { ClientShell } from "@/components/ClientShell";
import { ChannelTag, chLabel } from "@/components/ui";

const STATUSES = ["new", "qualified", "won", "lost", "spam"] as const;

export default async function Leads({ params, searchParams }: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ m?: string; ch?: string; type?: string; status?: string; q?: string }>;
}) {
  const { clientId } = await params;
  const sp = await searchParams;
  const { client, user } = await requireClient(clientId);
  const mo = resolveMonth(sp.m, client.timezone);
  const all = await leadsInMonth(client.id, mo.ym, client.timezone);
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = all.filter((l) =>
    (!sp.ch || l.channel === sp.ch) && (!sp.type || l.type === sp.type) && (!sp.status || l.status === sp.status) &&
    (!q || [l.name, l.email, l.phone, l.utmCampaign, l.adsCampaignName, l.adsKeyword, l.utmTerm, l.message].join(" ").toLowerCase().includes(q)));
  const base = `/c/${client.id}`;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: client.timezone, month: "short", day: "numeric" });
  const tm = new Intl.DateTimeFormat("en-US", { timeZone: client.timezone, hour: "numeric", minute: "2-digit" });
  const channelsPresent = CHANNEL_ORDER.filter((c) => all.some((l) => l.channel === c));

  return (
    <ClientShell client={client} active="leads" isAgency={user.isAgency} month={{ label: monthLabel(mo.ym), prev: mo.prev, next: mo.next, base: `${base}/leads` }}>
      <div><h1 className="vt">Leads</h1><p className="vsub">Open a lead to see how they found you, then mark it qualified, won or spam and add what the job was worth.</p></div>
      <form className="filters" method="get">
        <input type="hidden" name="m" value={mo.ym} />
        <select name="ch" defaultValue={sp.ch ?? ""} aria-label="Source"><option value="">All sources</option>{channelsPresent.map((c) => <option key={c} value={c}>{chLabel(c)}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} aria-label="Lead type"><option value="">Calls and forms</option><option value="call">Calls</option><option value="form">Forms</option></select>
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>
        <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Search name, campaign, keyword" aria-label="Search leads" />
        <button className="btn ghost" type="submit">Filter</button>
      </form>
      <section className="panel">
        <div className="ph"><h2>{rows.length} lead{rows.length === 1 ? "" : "s"}</h2><span>newest first</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Lead</th><th>Source</th><th className="hide-s">Campaign / keyword</th><th>Status</th><th className="n hide-s">Value</th><th className="n">When</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="empty">{all.length ? "No leads match these filters." : `No leads in ${monthLabel(mo.ym)} yet.`}</td></tr>}
            {rows.map((l) => {
              const href = `${base}/leads/${l.id}`;
              const camp = l.adsCampaignName ?? l.utmCampaign;
              const kw = l.adsKeyword ?? l.utmTerm;
              return (
                <tr key={l.id} className="click">
                  <td className="who"><Link className="rowlink" href={href}><b>{l.name || l.email || l.phone || "Unknown"}</b>
                    <span>{l.type === "call" ? `Call${l.callDurationSec ? ` · ${Math.floor(l.callDurationSec / 60)}m ${l.callDurationSec % 60}s` : ""}` : `Form${l.formName ? ` · ${l.formName}` : ""}`}</span></Link></td>
                  <td><ChannelTag channel={l.channel} /></td>
                  <td className="hide-s who"><b style={{ fontWeight: 500 }}>{camp ?? "—"}</b><span>{kw ?? ""}</span></td>
                  <td><span className={`st ${l.status}`}>{l.status}</span></td>
                  <td className="n hide-s">{l.status === "spam" ? "—" : money(l.status === "won" ? l.saleCents ?? l.valueCents : l.valueCents)}</td>
                  <td className="n who"><b style={{ fontWeight: 500 }}>{fmt.format(l.createdAt)}</b><span>{tm.format(l.createdAt)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </section>
    </ClientShell>
  );
}
