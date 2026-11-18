import Link from "next/link";
import { CHANNEL_LABELS, type Channel } from "@/lib/attribution";

export const chColor = (ch: string) => `var(--c-${ch in CHANNEL_LABELS ? ch : "direct"})`;
export const chLabel = (ch: string) => (ch === "gbp" ? "Business Profile" : CHANNEL_LABELS[ch as Channel] ?? ch);

export function Swatch({ color }: { color: string }) {
  return <i className="sw" style={{ background: color }} />;
}

export function ChannelTag({ channel }: { channel: string }) {
  return <span className="ch"><Swatch color={chColor(channel)} />{chLabel(channel)}</span>;
}

export function Delta({ pct, lowerIsBetter, vs }: { pct: number | null; lowerIsBetter?: boolean; vs: string }) {
  if (pct === null) return <>No data for {vs} yet</>;
  const good = lowerIsBetter ? pct <= 0 : pct >= 0;
  return <><span className={good ? "up" : "down"}>{pct > 0 ? "▲" : pct < 0 ? "▼" : "■"} {Math.abs(pct)}%</span> vs {vs}</>;
}

export function Header({ title, sub, initials, logoUrl, home = "/", right, tabs }: {
  title: string; sub?: string; initials: string; logoUrl?: string | null; home?: string;
  right?: React.ReactNode; tabs?: { href: string; label: string; current?: boolean; team?: boolean }[];
}) {
  return (
    <header className="top gut">
      <div className="wrap">
        <div className="bar1">
          <Link className="client" href={home}>
            <div className="logo" aria-hidden="true">{logoUrl ? <img src={logoUrl} alt="" /> : initials}</div>
            <div><b>{title}</b>{sub && <small>{sub}</small>}</div>
          </Link>
          <div className="ctrls">
            {right}
            <form action="/api/logout" method="post"><button className="pill" type="submit">Sign out</button></form>
          </div>
        </div>
        {tabs && (
          <nav className="tabs" aria-label="Sections">
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} className={t.team ? "team" : undefined} aria-current={t.current ? "page" : undefined}>
                {t.label}{t.team && <span>team</span>}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
