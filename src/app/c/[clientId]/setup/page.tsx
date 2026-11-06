/** Team-only: install codes, automatic health checks, and logins for this client. */
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireClient, type Role } from "@/lib/access";
import { hashPassword, tempPassword } from "@/lib/password";
import { ClientShell } from "@/components/ClientShell";

const FLASH = "sbm_flash";

async function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

async function addUser(clientId: string, form: FormData) {
  "use server";
  const { user } = await requireClient(clientId);
  if (!user.isAgency) notFound();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim() || null;
  const role = String(form.get("role")) as Role | "team";
  if (!email.includes("@")) redirect(`/c/${clientId}/setup?e=email`);
  if (role === "team" && user.agencyRole !== "agency_admin") notFound();

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  let pw: string | null = null;
  let userId = existing?.id;
  if (!existing) {
    pw = tempPassword();
    const [u] = await db.insert(schema.users).values({
      email, name, passwordHash: await hashPassword(pw),
      isAgency: role === "team", agencyRole: role === "team" ? "agency_staff" : null,
    }).returning({ id: schema.users.id });
    userId = u.id;
  }
  if (role !== "team" && userId) {
    const r: Role = role === "client_viewer" ? "client_viewer" : "client_owner";
    await db.insert(schema.memberships).values({ userId, clientId, role: r })
      .onConflictDoUpdate({ target: [schema.memberships.userId, schema.memberships.clientId], set: { role: r } });
  }
  (await cookies()).set(FLASH, JSON.stringify({ email, pw }), { httpOnly: true, secure: true, sameSite: "lax", path: `/c/${clientId}/setup`, maxAge: 120 });
  redirect(`/c/${clientId}/setup`);
}

async function resetPassword(clientId: string, userId: string) {
  "use server";
  const { user } = await requireClient(clientId);
  if (!user.isAgency) notFound();
  const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.clientId, clientId))).limit(1);
  if (!m) notFound();
  const pw = tempPassword();
  const [u] = await db.update(schema.users).set({ passwordHash: await hashPassword(pw) }).where(eq(schema.users.id, userId)).returning({ email: schema.users.email });
  (await cookies()).set(FLASH, JSON.stringify({ email: u.email, pw, reset: true }), { httpOnly: true, secure: true, sameSite: "lax", path: `/c/${clientId}/setup`, maxAge: 120 });
  redirect(`/c/${clientId}/setup`);
}

async function removeUser(clientId: string, userId: string) {
  "use server";
  const { user } = await requireClient(clientId);
  if (!user.isAgency) notFound();
  await db.delete(schema.memberships).where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.clientId, clientId)));
  redirect(`/c/${clientId}/setup`);
}

function ago(d: Date | null) {
  if (!d) return null;
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  return m < 2 ? "just now" : m < 60 ? `${m} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
}

export default async function Setup({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ e?: string }> }) {
  const { clientId } = await params;
  const { e } = await searchParams;
  const { client, user } = await requireClient(clientId);
  if (!user.isAgency) notFound();
  const base = await appUrl();
  const sites = await db.select().from(schema.sites).where(eq(schema.sites.clientId, client.id));
  const [last] = await db.select().from(schema.leads).where(eq(schema.leads.clientId, client.id)).orderBy(desc(schema.leads.createdAt)).limit(1);
  const [withAttr] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leads)
    .where(and(eq(schema.leads.clientId, client.id), sql`${schema.leads.lastTouch} is not null`));
  const members = await db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.memberships.role, lastLoginAt: schema.users.lastLoginAt })
    .from(schema.memberships).innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.clientId, client.id));
  const flashRaw = (await cookies()).get(FLASH)?.value;
  let flash: { email: string; pw: string | null; reset?: boolean } | null = null;
  try { flash = flashRaw ? JSON.parse(flashRaw) : null; } catch { flash = null; }

  const col = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)" };
  const day = 864e5;

  return (
    <ClientShell client={client} active="setup" isAgency>
      <div><h1 className="vt">Setup &amp; verify</h1><p className="vsub">Only the Silverback team sees this tab. Follow docs/ONBOARDING.md, then check that every line here is green.</p></div>
      {sites.map((s) => {
        const checks: [keyof typeof col, string, string][] = [
          [s.lastSeenAt && Date.now() - s.lastSeenAt.getTime() < day ? "good" : s.lastSeenAt ? "warn" : "bad", "Tracking code is on the site",
            s.lastSeenAt ? `Last heard from ${ago(s.lastSeenAt)}` : "Not seen yet. Paste the snippet in the site header and load a page."],
          [s.lastFieldSeenAt && Date.now() - s.lastFieldSeenAt.getTime() < 7 * day ? "good" : "bad", "Hidden sb_data field found on a form",
            s.lastFieldSeenAt ? `Last found ${ago(s.lastFieldSeenAt)}` : "Not found yet. Add a Hidden field with ID sb_data to each Elementor form."],
          [last ? (withAttr.n > 0 ? "good" : "warn") : "bad", "Leads arriving with their source",
            last ? `${withAttr.n} lead${withAttr.n === 1 ? "" : "s"} with tracking data · last lead ${ago(last.createdAt)}` : "No leads yet. Submit a test lead with ?utm_source=test on the URL."],
        ];
        const hook = `${base}/api/ingest/elementor/${s.siteKey}?token=${s.ingestToken}`;
        return (
          <div className="cols" key={s.id}>
            <section className="panel"><div className="ph"><h2>Health checks · {s.domain}</h2><span>{checks.filter((c) => c[0] === "good").length} of {checks.length} passing</span></div>
              <div>{checks.map(([st, t, d]) => <div className="check" key={t}><i className="sd" style={{ background: col[st] }} /><div><b>{t}</b><span>{d}</span></div></div>)}</div>
              <p className="vsub" style={{ margin: 0, fontSize: 12.5 }}>Google Analytics, Ads, Business Profile and call checks are added with those connections.</p>
            </section>
            <section className="panel"><div className="ph"><h2>Install</h2></div>
              <p style={{ margin: 0, fontSize: 13.5 }}>1. Paste in the site header (Elementor → Custom Code):</p>
              <pre className="snip">{`<script async src="${base}/t.js" data-site="${s.siteKey}"></script>`}</pre>
              <p style={{ margin: 0, fontSize: 13.5 }}>2. On every Elementor form, add a <b>Hidden</b> field with ID <b>sb_data</b>.</p>
              <p style={{ margin: 0, fontSize: 13.5 }}>3. Add a <b>Webhook</b> action with this URL and turn on <b>Advanced Data</b>:</p>
              <pre className="snip">{hook}</pre>
              <p className="vsub" style={{ margin: 0, fontSize: 12.5 }}>Keep the webhook URL private: it lets anyone post leads to this client.</p>
            </section>
          </div>
        );
      })}

      <section className="panel">
        <div className="ph"><h2>Client logins</h2><span>owners can edit lead status and value · viewers can only look</span></div>
        {flash && (
          <div className="notice">
            {flash.pw ? <>{flash.reset ? "New password" : "Login created"} for <b>{flash.email}</b>. Temporary password: <b style={{ fontFamily: "ui-monospace,monospace" }}>{flash.pw}</b>. Send it to them now; it won't be shown again.</>
              : <><b>{flash.email}</b> already had a login, so they now also have access to {client.name}.</>}
          </div>
        )}
        {e === "email" && <p className="err">Enter a valid email address.</p>}
        <div className="tbl"><table>
          <thead><tr><th>Person</th><th>Access</th><th className="hide-s">Last sign-in</th><th></th></tr></thead>
          <tbody>
            {members.length === 0 && <tr><td colSpan={4} className="empty">No client logins yet.</td></tr>}
            {members.map((m) => (
              <tr key={m.id}>
                <td className="who"><b>{m.name ?? m.email}</b><span>{m.email}</span></td>
                <td>{m.role === "client_owner" ? "Owner" : "Viewer"}</td>
                <td className="hide-s">{ago(m.lastLoginAt) ?? "Never"}</td>
                <td className="n">
                  <form action={resetPassword.bind(null, client.id, m.id)} style={{ display: "inline" }}><button className="pill" type="submit">Reset password</button></form>{" "}
                  <form action={removeUser.bind(null, client.id, m.id)} style={{ display: "inline" }}><button className="pill" type="submit">Remove</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <form action={addUser.bind(null, client.id)} className="filters">
          <input name="email" type="email" placeholder="email@client.com" aria-label="Email" required />
          <input name="name" placeholder="Name" aria-label="Name" />
          <select name="role" aria-label="Access" defaultValue="client_owner">
            <option value="client_owner">Owner (can edit leads)</option>
            <option value="client_viewer">Viewer (read only)</option>
            {user.agencyRole === "agency_admin" && <option value="team">Silverback team member</option>}
          </select>
          <button className="btn" type="submit">Add login</button>
        </form>
      </section>
    </ClientShell>
  );
}
