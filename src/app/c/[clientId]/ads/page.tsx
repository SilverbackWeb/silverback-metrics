/** Google Ads (and Local Services Ads): spend from Google, matched to the real leads it produced. */
import Link from "next/link";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireClient } from "@/lib/access";
import { leadsInMonth, resolveMonth } from "@/lib/queries";
import { monthLabel, monthRange, money, summarize } from "@/lib/reports";
import { ClientShell } from "@/components/ClientShell";

export default async function Ads({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ m?: string }> }) {
  const { clientId } = await params;
  const { client, user } = await requireClient(clientId);
  const tz = client.timezone;
  const mo = resolveMonth((await searchParams).m, tz);
  const { start, end } = monthRange(mo.ym, tz);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const [leads, spend] = await Promise.all([
    leadsInMonth(client.id, mo.ym, tz),
    db.select({
      campaignId: schema.adsDaily.campaignId, name: sql<string>`max(${schema.adsDaily.campaignName})`,
      clicks: sql<number>`sum(${schema.adsDaily.clicks})::int`, cost: sql<number>`sum(${schema.adsDaily.costMicros})::float8`,
      conv: sql<number>`sum(${schema.adsDaily.conversions})::float8`,
    }).from(schema.adsDaily)
      .where(and(eq(schema.adsDaily.clientId, client.id), gte(schema.adsDaily.day, day(start)), lt(schema.adsDaily.day, day(end))))
      .groupBy(schema.adsDaily.campaignId),
  ]);
  const adLeads = leads.filter((l) => l.channel === "google_ads");
  const s = summarize(adLeads);
  const totalCost = spend.reduce((a, r) => a + r.cost / 1e6, 0);
  const connected = spend.length > 0;

  // Leads per campaign: by the campaign Google Ads resolved for the click, else the utm_campaign on the link.
  const byCamp = new Map<string, typeof adLeads>();
  for (const l of adLeads) {
    const k = l.adsCampaignId ?? l.adsCampaignName ?? l.utmCampaign ?? "(campaign not tagged)";
    byCamp.set(k, [...(byCamp.get(k) ?? []), l]);
  }
  const rows = connected
    ? spend.map((r) => {
      const ls = [...(byCamp.get(r.campaignId) ?? []), ...(byCamp.get(r.name) ?? [])];
      const sm = summarize(ls);
      return { name: r.name || r.campaignId, cost: r.cost / 1e6, clicks: r.clicks, conv: r.conv, leads: sm.leads, qualified: sm.qualified };
    })
    : [...byCamp.entries()].map(([name, ls]) => { const sm = summarize(ls); return { name, cost: null, clicks: null, conv: null, leads: sm.leads, qualified: sm.qualified }; });
  const keywords = new Map<string, number>();
  for (const l of adLeads) { const k = l.adsKeyword ?? l.utmTerm; if (k) keywords.set(k, (keywords.get(k) ?? 0) + 1); }
  const base = `/c/${client.id}/ads`;

  return (
    <ClientShell client={client} active="ads" isAgency={user.isAgency} month={{ label: monthLabel(mo.ym), prev: mo.prev, next: mo.next, base }}>
      <div><h1 className="vt">Google Ads</h1><p className="vsub">Spend from Google Ads, matched to the real calls and forms it produced.</p></div>
      <div className="kpis">
        <div className="kpi"><span className="l">Ad spend</span><span className="v">{connected ? money(totalCost * 100) : "—"}</span><span className="d">{connected ? `${spend.reduce((a, r) => a + r.clicks, 0).toLocaleString()} clicks` : "connect Google Ads to see spend"}</span></div>
        <div className="kpi"><span className="l">Leads from Ads</span><span className="v">{s.leads}</span><span className="d">{s.calls} calls · {s.forms} forms</span></div>
        <div className="kpi"><span className="l">Cost per lead</span><span className="v">{connected && s.leads ? money((totalCost / s.leads) * 100) : "—"}</span><span className="d">spend ÷ real leads</span></div>
        <div className="kpi"><span className="l">Won revenue</span><span className="v">{money(s.wonCents)}</span><span className="d">{s.won} job{s.won === 1 ? "" : "s"} from Ads</span></div>
      </div>
      {!connected && <p className="notice">Google Ads isn&apos;t connected for this client yet. Leads from ads already show here (we see the Google click ID on every ad visit); spend, clicks and cost per lead appear once the account is connected.</p>}
      <section className="panel"><div className="ph"><h2>Campaigns</h2><span>{connected ? "\"Google says\" is what Ads reports; Leads are the ones we actually received" : "leads by campaign"}</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Campaign</th>{connected && <><th className="n">Spend</th><th className="n hide-s">Clicks</th><th className="n hide-s">Google says</th></>}<th className="n">Leads</th><th className="n">Qualified</th>{connected && <th className="n">Cost / lead</th>}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="empty">No ad leads in {monthLabel(mo.ym)}.</td></tr>}
            {rows.map((r) => <tr key={r.name}><td>{r.name}</td>
              {connected && <><td className="n">{money((r.cost ?? 0) * 100)}</td><td className="n hide-s">{r.clicks}</td><td className="n hide-s">{Math.round(r.conv ?? 0)}</td></>}
              <td className="n"><b>{r.leads}</b></td><td className="n">{r.qualified}</td>
              {connected && <td className="n">{r.leads ? money(((r.cost ?? 0) / r.leads) * 100) : "—"}</td>}</tr>)}
          </tbody>
        </table></div>
      </section>
      {keywords.size > 0 && (
        <section className="panel"><div className="ph"><h2>Keywords that produced leads</h2><span>from the ad click</span></div>
          <div className="tbl"><table><thead><tr><th>Keyword</th><th className="n">Leads</th></tr></thead>
            <tbody>{[...keywords.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => <tr key={k}><td>{k}</td><td className="n">{n}</td></tr>)}</tbody></table></div>
        </section>
      )}
      <section className="panel"><div className="ph"><h2>Local Services Ads</h2><span>Google Guaranteed / Screened</span></div>
        <p className="empty">Coming with the Google Ads connection: Local Services leads (calls and messages), spend, and cost per lead. They come from the same Google Ads account.</p>
      </section>
      <p className="foot"><Link href={`/c/${client.id}/leads?m=${mo.ym}&ch=google_ads`}>See every ad lead →</Link></p>
    </ClientShell>
  );
}
