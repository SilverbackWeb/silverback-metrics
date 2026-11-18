/**
 * Who is signed in, and which clients they may see. Every page and action that touches
 * client data goes through requireClient(), so a client login can never read another client.
 */
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { COOKIE, readSession } from "./session";

export type Role = (typeof schema.roleEnum.enumValues)[number];
export type User = typeof schema.users.$inferSelect;
export type Client = typeof schema.clients.$inferSelect;

export async function currentUser(): Promise<User | null> {
  const s = await readSession((await cookies()).get(COOKIE)?.value);
  if (!s) return null;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.userId)).limit(1);
  return u ?? null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireAgency(): Promise<User> {
  const u = await requireUser();
  if (!u.isAgency) notFound();
  return u;
}

/** Pure rule, unit-tested: what a role may do on a client. */
export function permissions(user: Pick<User, "isAgency" | "agencyRole">, membershipRole: Role | null, client: Pick<Client, "clientsCanEditLeads">) {
  if (user.isAgency) {
    return { view: true, editLeads: true, manage: true, admin: user.agencyRole === "agency_admin" };
  }
  if (!membershipRole) return { view: false, editLeads: false, manage: false, admin: false };
  return {
    view: true,
    editLeads: membershipRole === "client_owner" && client.clientsCanEditLeads,
    manage: false,
    admin: false,
  };
}

export async function requireClient(clientId: string) {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) notFound();
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).limit(1);
  if (!client) notFound();
  let role: Role | null = null;
  if (!user.isAgency) {
    const [m] = await db.select().from(schema.memberships)
      .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.clientId, clientId))).limit(1);
    role = m?.role ?? null;
  }
  const can = permissions(user, role, client);
  if (!can.view) notFound();
  return { user, client, role, can };
}

/** Clients this user can open, alphabetical. */
export async function clientsFor(user: User): Promise<Client[]> {
  if (user.isAgency) return db.select().from(schema.clients).orderBy(asc(schema.clients.name));
  const rows = await db.select({ c: schema.clients }).from(schema.memberships)
    .innerJoin(schema.clients, eq(schema.memberships.clientId, schema.clients.id))
    .where(eq(schema.memberships.userId, user.id)).orderBy(asc(schema.clients.name));
  return rows.map((r) => r.c);
}
