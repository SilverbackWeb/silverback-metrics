import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyPassword } from "@/lib/password";
import { COOKIE, cookieOptions, signSession } from "@/lib/session";

export const metadata = { title: "Sign in · Silverback Metrics" };

async function login(form: FormData) {
  "use server";
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const [u] = await db.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, email)).limit(1);
  if (!u || !(await verifyPassword(password, u.passwordHash))) redirect("/login?e=1");
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
  (await cookies()).set(COOKIE, await signSession({ userId: u.id, name: u.name ?? u.email, agency: u.isAgency }), cookieOptions);
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <main className="auth gut">
      <form action={login}>
        <h1>Silverback <span>Metrics</span></h1>
        <p className="vsub" style={{ margin: 0 }}>Sign in to see your leads and where they came from.</p>
        {e && <p className="err">That email and password don't match. Check both and try again.</p>}
        <label className="field" htmlFor="email">Email<input id="email" name="email" type="email" autoComplete="email" required /></label>
        <label className="field" htmlFor="password">Password<input id="password" name="password" type="password" autoComplete="current-password" required /></label>
        <button className="btn" type="submit">Sign in</button>
      </form>
    </main>
  );
}
