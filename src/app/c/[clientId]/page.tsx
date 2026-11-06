import Link from "next/link";
import { requireClient } from "@/lib/access";
import { leadsInMonth, resolveMonth } from "@/lib/queries";
import { byChannel, byWeek, money, monthLabel, pctChange, summarize, topLandingPages } from "@/lib/reports";
import { ClientShell } from "@/components/ClientShell";
import { ChannelTag, Delta, Swatch, chColor, chLabel } from "@/components/ui";

export default async function Overview({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ m?: string }> }) {
  const { clientId } = await params;
  const { client, user } = await requireClient(clientId);
  const tz = client.timezone;
  const mo = resolveMonth((await searchParams).m, tz);
  const [leads, prevLeads] = await Promise.all([leadsInMonth(client.id, mo.ym, tz), leadsInMonth(client.id, mo.prev, tz)]);
  const s = summarize(leads), p = summarize(prevLeads);
  const channels = byChannel(leads);
  const [y, m] = mo.ym.split("-").map(Number);
  const weeks = byWeek(leads, tz, new Date(Date.UTC(y, m, 0)).getUTCDate());
  const pages = topLandingPages(leads);
  const prevName = monthLabel(mo.prev).split(" ")[0];
  const base = `/c/${client.id}`;
  const max = Math.max(1, ...channels.map((c) => c.leads));

  return (
    <ClientShell client={client} active="overview" isAgency={user.isAgency} month={{ label: monthLabel(mo.ym), prev: mo.prev, next: mo.next, base }}>
      <div><h1 className="vt">{monthLabel(mo.ym).split(" ")[0]} at a glance</h1>
        <p className="vsub">Every call and form fill from your website, Google Business Profile and ads, with where it came from.</p></div>
      <div className="kpis">
        <div className="kpi"><span className="l">Leads</span><span className="v">{s.leads}</span><span className="d"><Delta pct={pctChange(s.leads, p.leads)} vs={prevName} /></span></div>
        <div className="kpi"><span className="l">Qualified leads</span><span className="v">{s.qualified}</span><span className="d"><Delta pct={pctChange(s.qualified, p.qualified)} vs={prevName} /></span></div>
        <div className="kpi"><span className="l">Calls · forms</span><span className="v">{s.calls} · {s.forms}</span><span className="d">{s.spam ? `${s.spam} spam filtered out` : "No spam this month"}</span></div>
        <div className="kpi"><span className="l">Won revenue</span><span className="v">{money(s.wonCents)}</span><span className="d">{s.won} job{s.won === 1 ? "" : "s"} marked won</span></div>
      </div>

      {s.leads === 0 ? (
        <section className="panel"><p className="empty">No leads in {monthLabel(mo.ym)} yet. They show up here as soon as a form is submitted or a call comes in.</p></section>
      ) : (<>
        <div className="cols">
          <section className="panel"><div className="ph"><h2>Leads by week</h2><span>stacked by source</span></div>
            <WeekChart weeks={weeks} month={monthLabel(mo.ym).slice(0, 3)} />
            <div className="legend">{channels.map((c) => <span key={c.channel}><Swatch color={chColor(c.channel)} />{chLabel(c.channel)}</span>)}</div>
          </section>
          <section className="panel"><div className="ph"><h2>Top landing pages</h2><span>where leads first landed</span></div>
            <div className="tbl"><table><thead><tr><th>Page</th><th className="n">Leads</th></tr></thead>
              <tbody>{pages.length ? pages.map(([pg, n]) => <tr key={pg}><td>{pg}</td><td className="n">{n}</td></tr>) : <tr><td colSpan={2} className="empty">No landing pages recorded.</td></tr>}</tbody></table></div>
          </section>
        </div>
        <section className="panel"><div className="ph"><h2>Where leads came from</h2><span>last way they found you before reaching out</span></div>
          <div className="tbl"><table><thead><tr><th>Source</th><th className="hide-s" style={{ width: "30%" }}></th><th className="n">Leads</th><th className="n">Qualified</th><th className="n">Won</th><th className="n">Revenue</th></tr></thead>
            <tbody>{channels.map((c) => (
              <tr key={c.channel} className="click">
                <td><Link className="rowlink" href={`${base}/leads?m=${mo.ym}&ch=${c.channel}`}><ChannelTag channel={c.channel} /></Link></td>
                <td className="hide-s"><div className="minibar"><i style={{ width: `${(c.leads / max) * 100}%`, background: chColor(c.channel) }} /></div></td>
                <td className="n">{c.leads}</td><td className="n">{c.qualified}</td><td className="n">{c.won}</td><td className="n">{money(c.wonCents)}</td>
              </tr>))}</tbody></table></div>
        </section>
      </>)}
      <p className="foot">Google Ads spend, rankings and map heat maps are added in the next phases.</p>
    </ClientShell>
  );
}

function WeekChart({ weeks, month }: { weeks: ReturnType<typeof byWeek>; month: string }) {
  const W = 560, H = 210, pl = 30, pb = 26, pt = 14;
  const top = Math.max(5, Math.ceil(Math.max(...weeks.map((w) => w.total)) / 5) * 5);
  const step = top <= 10 ? 2 : top <= 25 ? 5 : Math.ceil(top / 5 / 5) * 5;
  const y = (v: number) => H - pb - (v / top) * (H - pb - pt);
  const bw = ((W - pl) / weeks.length) * 0.5;
  const ticks: number[] = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Leads per week, stacked by source">
      {ticks.map((v) => <g key={v}><line x1={pl} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={pl - 6} y={y(v) + 4} fontSize="11" textAnchor="end">{v}</text></g>)}
      {weeks.map((w, i) => {
        const cx = pl + ((W - pl) / weeks.length) * (i + 0.5);
        let acc = 0;
        return (
          <g key={i}>
            {w.parts.map((p) => { const r = <rect key={p.channel} x={cx - bw / 2} y={y(acc + p.n)} width={bw} height={y(acc) - y(acc + p.n)} fill={chColor(p.channel)} />; acc += p.n; return r; })}
            <text x={cx} y={y(w.total) - 6} fontSize="12" textAnchor="middle" style={{ fill: "var(--fg)", fontWeight: 600 }}>{w.total}</text>
            <text x={cx} y={H - 8} fontSize="11.5" textAnchor="middle">{month} {w.from}–{w.to}</text>
          </g>
        );
      })}
    </svg>
  );
}
