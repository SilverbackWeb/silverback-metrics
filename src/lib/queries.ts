import { and, desc, eq, gte, lt } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { currentMonth, monthRange, shiftMonth } from "./reports";

/** Resolve ?m=YYYY-MM against the client's time zone; never past the current month. */
export function resolveMonth(param: string | undefined, tz: string) {
  const now = currentMonth(tz);
  const ym = param && /^\d{4}-\d{2}$/.test(param) && param <= now ? param : now;
  return { ym, prev: shiftMonth(ym, -1), next: ym < now ? shiftMonth(ym, 1) : null };
}

export async function leadsInMonth(clientId: string, ym: string, tz: string) {
  const { start, end } = monthRange(ym, tz);
  return db.select().from(schema.leads)
    .where(and(eq(schema.leads.clientId, clientId), gte(schema.leads.createdAt, start), lt(schema.leads.createdAt, end)))
    .orderBy(desc(schema.leads.createdAt));
}

/** A lead, only if it belongs to this client. Callers must have passed requireClient(clientId). */
export async function loadLead(clientId: string, leadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) notFound();
  const [lead] = await db.select().from(schema.leads).where(and(eq(schema.leads.id, leadId), eq(schema.leads.clientId, clientId))).limit(1);
  if (!lead) notFound();
  return lead;
}

