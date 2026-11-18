/**
 * First-time setup: creates the first Silverback admin login. Needs SETUP_KEY and only
 * works while no agency user exists yet, so it can't be used to take over the app later.
 */
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword } from "@/lib/password";

export const metadata = { title: "Setup · Silverback Metrics" };

async function hasAdmin() {
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isAgency, true)).limit(1);
  return !!u;
}

async function createAdmin(form: FormData) {
  "use server";
  const key = process.env.SETUP_KEY;
  if (!key || String(form.get("key")) !== key) redirect("/setup?e=key");
  if (await hasAdmin()) redirect("/login");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email.includes("@") || password.length < 10) redirect("/setup?e=input");
  await db.insert(schema.users).values({
    email, name: String(form.get("name") ?? "").trim() || email,
    isAgency: true, agencyRole: "agency_admin", passwordHash: await hashPassword(password),
  });
  redirect("/login");
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await hasAdmin()) redirect("/login");
  const { e } = await searchParams;
  return (
    <main className="auth gut">
      <form action={createAdmin}>
        <h1>First-time <span>setup</span></h1>
        <p className="vsub" style={{ margin: 0 }}>Create the first Silverback admin login. This page turns itself off once that's done.</p>
        {e === "key" && <p className="err">The setup key doesn't match the SETUP_KEY secret.</p>}
        {e === "input" && <p className="err">Enter a valid email and a password of at least 10 characters.</p>}
        <label className="field" htmlFor="key">Setup key<input id="key" name="key" type="password" required /></label>
        <label className="field" htmlFor="name">Your name<input id="name" name="name" autoComplete="name" /></label>
        <label className="field" htmlFor="email">Email<input id="email" name="email" type="email" autoComplete="email" required /></label>
        <label className="field" htmlFor="password">Password (10+ characters)<input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required /></label>
        <button className="btn" type="submit">Create admin</button>
      </form>
    </main>
  );
}
