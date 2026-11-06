import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireClient } from "@/lib/access";
import type { Touch } from "@/lib/attribution";
import { journeySteps } from "@/lib/journey";
import { money } from "@/lib/reports";
import { updateLead } from "./actions";
import { loadLead } from "@/lib/queries";
import { STATUSES } from "./statuses";
import { ClientShell } from "@/components/ClientShell";
import { ChannelTag, chColor } from "@/components/ui";

export default async function LeadPage({ params }: { params: Promise<{ clientId: string; leadId: string }> }) {
  const { clientId, leadId } = await params;
  const { client, user, can } = await requireClient(clientId);
  const lead = await loadLead(client.id, leadId);
  const edits = await db.select().from(schema.leadEdits).where(eq(schema.leadEdits.leadId, lead.id)).orderBy(desc(schema.leadEdits.createdAt)).limit(20);
  const when = new Intl.DateTimeFormat("en-US", { timeZone: client.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const steps = journeySteps(lead.firstTouch as Touch | null, lead.lastTouch as Touch | null, lead);
  const action = updateLead.bind(null, client.id, lead.id);
  const fieldName: Record<string, string> = { status: "status", value: "lead value", sale: "sale amount" };

  return (
    <ClientShell client={client} active="leads" isAgency={user.isAgency}>
      <div className="vhead">
        <div><p className="vsub" style={{ margin: 0 }}><Link href={`/c/${client.id}/leads`}>← All leads</Link></p>
          <h1 className="vt">{lead.name || lead.email || lead.phone || "Unknown lead"}</h1>
          <p className="vsub">{lead.type === "call" ? "Phone call" : "Form lead"} · {when.format(lead.createdAt)} · <ChannelTag channel={lead.channel} /></p></div>
        <span className={`st ${lead.status}`}>{lead.status}</span>
      </div>
      <div className="cols">
        <div className="view">
          <section className="panel">
            <p className="sect">How they found you</p>
            <ol className="journey">{steps.map((s, i) => (
              <li key={i}><i className="dot" style={{ background: s.channel === "lead" ? "var(--accent-fill)" : chColor(s.channel) }} />
                <div><b>{s.title}</b><span>{[s.at ? when.format(s.at) : null, s.detail].filter(Boolean).join(" · ")}</span></div></li>
            ))}</ol>
            {!lead.firstTouch && !lead.lastTouch && <p className="vsub" style={{ margin: 0 }}>No tracking data came with this lead. Check that the form has the hidden sb_data field.</p>}
            {(lead.adsCampaignName || lead.adsKeyword) && <dl className="kv"><dt>Campaign</dt><dd>{lead.adsCampaignName}</dd><dt>Keyword</dt><dd>{lead.adsKeyword}</dd></dl>}
          </section>
          <section className="panel">
            <p className="sect">Contact</p>
            <dl className="kv">
              {lead.phone && <><dt>Phone</dt><dd>{lead.phone}</dd></>}
              {lead.email && <><dt>Email</dt><dd>{lead.email}</dd></>}
              {lead.message && <><dt>Message</dt><dd>{lead.message}</dd></>}
              {lead.pageUrl && <><dt>Form page</dt><dd>{lead.pageUrl}</dd></>}
              {lead.recordingUrl && <><dt>Recording</dt><dd><a href={lead.recordingUrl} target="_blank" rel="noreferrer">Listen</a></dd></>}
              {lead.spamReasons && lead.spamReasons.length > 0 && <><dt>Spam check</dt><dd>{lead.spamReasons.join(", ")}</dd></>}
            </dl>
            {!lead.phone && !lead.email && !lead.message && !lead.pageUrl && <p className="vsub" style={{ margin: 0 }}>No contact details came with this lead.</p>}
          </section>
        </div>
        <section className="panel" style={{ alignSelf: "start" }}>
          <p className="sect">Lead outcome</p>
          {can.editLeads ? (
            <div className="edit">
              <form action={action} className="seg" aria-label="Lead status">
                {STATUSES.map((s) => <button key={s} name="status" value={s} aria-pressed={lead.status === s} type="submit">{s[0].toUpperCase() + s.slice(1)}</button>)}
              </form>
              <form action={action} className="money">
                <label htmlFor="value">Lead value ($)<input id="value" name="value" inputMode="decimal" defaultValue={lead.valueCents != null ? lead.valueCents / 100 : ""} /></label>
                <label htmlFor="sale">Sale amount ($)<input id="sale" name="sale" inputMode="decimal" placeholder="if won" defaultValue={lead.saleCents != null ? lead.saleCents / 100 : ""} /></label>
                <button className="btn" type="submit">Save</button>
              </form>
            </div>
          ) : (
            <dl className="kv"><dt>Lead value</dt><dd>{money(lead.valueCents)}</dd><dt>Sale amount</dt><dd>{money(lead.saleCents)}</dd></dl>
          )}
          {edits.length ? (
            <ul className="log">{edits.map((e) => <li key={e.id}>{e.userName ?? "Someone"} changed {fieldName[e.field] ?? e.field} from {e.oldValue ?? "—"} to {e.newValue ?? "—"} · {when.format(e.createdAt)}</li>)}</ul>
          ) : <p className="vsub" style={{ margin: 0, fontSize: 12.5 }}>Changes are logged with who made them and when.</p>}
        </section>
      </div>
    </ClientShell>
  );
}
