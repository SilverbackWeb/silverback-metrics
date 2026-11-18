import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireAgency } from "@/lib/access";
import { randomToken } from "@/lib/password";
import { Header } from "@/components/ui";
import { cleanDomain } from "@/lib/util";

const dollars = (v: FormDataEntryValue | null) => Math.max(0, Math.round(Number(String(v ?? "0").replace(/[^0-9.]/g, "")) * 100)) || 0;

async function createClient(form: FormData) {
  "use server";
  await requireAgency();
  const name = String(form.get("name") ?? "").trim();
  const domain = cleanDomain(String(form.get("domain") ?? ""));
  if (!name || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) redirect("/clients/new?e=1");
  const [client] = await db.insert(schema.clients).values({
    name,
    website: `https://${domain}`,
    timezone: String(form.get("timezone") || "America/Chicago"),
    defaultFormValueCents: dollars(form.get("formValue")),
    defaultCallValueCents: dollars(form.get("callValue")),
  }).returning({ id: schema.clients.id });
  await db.insert(schema.sites).values({
    clientId: client.id, domain, siteKey: randomToken(6).toLowerCase(), ingestToken: randomToken(24),
  });
  redirect(`/c/${client.id}/setup`);
}

export default async function NewClient({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  await requireAgency();
  const { e } = await searchParams;
  return (
    <>
      <Header title="Silverback Metrics" sub="New client" initials="SB" />
      <main className="gut"><div className="wrap view" style={{ maxWidth: 720 }}>
        <div><h1 className="vt">New client</h1><p className="vsub">Creates the client and its site. Next you'll get the tracking code and the Elementor webhook URL.</p></div>
        <form action={createClient} className="panel">
          {e && <p className="err">Enter the business name and a website domain like gatewayroofingstl.com.</p>}
          <div className="formgrid">
            <label className="field" htmlFor="name">Business name<input id="name" name="name" required /></label>
            <label className="field" htmlFor="domain">Website domain<input id="domain" name="domain" placeholder="clientsite.com" required /></label>
            <label className="field" htmlFor="formValue">Default value of a form lead ($)<input id="formValue" name="formValue" inputMode="decimal" defaultValue="150" /></label>
            <label className="field" htmlFor="callValue">Default value of a call lead ($)<input id="callValue" name="callValue" inputMode="decimal" defaultValue="200" /></label>
            <label className="field" htmlFor="timezone">Time zone
              <select id="timezone" name="timezone" defaultValue="America/Chicago">
                {["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"].map((z) => <option key={z} value={z}>{z.replace("America/", "").replace("_", " ")}</option>)}
              </select></label>
          </div>
          <div style={{ display: "flex", gap: 8 }}><button className="btn" type="submit">Create client</button><Link className="btn ghost" href="/">Cancel</Link></div>
        </form>
      </div></main>
    </>
  );
}
