import Link from "next/link";
import type { Client } from "@/lib/access";
import { Header, initialsOf } from "./ui";

type Tab = "overview" | "leads" | "setup";

export function ClientShell({ client, active, isAgency, month, children }: {
  client: Client; active: Tab; isAgency: boolean; month?: { label: string; prev: string; next: string | null; base: string };
  children: React.ReactNode;
}) {
  const base = `/c/${client.id}`;
  const tabs = [
    { href: base, label: "Overview", current: active === "overview" },
    { href: `${base}/leads`, label: "Leads", current: active === "leads" },
    ...(isAgency ? [{ href: `${base}/setup`, label: "Setup", current: active === "setup", team: true }] : []),
  ];
  const right = month ? (
    <>
      <Link className="pill" href={`${month.base}?m=${month.prev}`} aria-label="Previous month">‹</Link>
      <span className="pill on">{month.label}</span>
      {month.next ? <Link className="pill" href={`${month.base}?m=${month.next}`} aria-label="Next month">›</Link> : null}
    </>
  ) : undefined;
  return (
    <>
      <Header title={client.name} sub={client.website?.replace(/^https?:\/\//, "") ?? undefined} initials={initialsOf(client.name)}
        logoUrl={client.logoUrl} home={isAgency ? "/" : base} tabs={tabs} right={right} />
      <main className="gut"><div className="wrap view">{children}</div></main>
    </>
  );
}
