"use server";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireClient } from "@/lib/access";
import { money } from "@/lib/reports";
import { parseDollars } from "@/lib/util";
import { loadLead } from "@/lib/queries";

const STATUS_LIST = ["new", "qualified", "won", "lost", "spam"] as const;
type Status = (typeof STATUS_LIST)[number];

export async function updateLead(clientId: string, leadId: string, form: FormData) {
  const { user, can } = await requireClient(clientId);
  if (!can.editLeads) notFound();
  const lead = await loadLead(clientId, leadId);
  const edits: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  const set: Partial<typeof schema.leads.$inferInsert> = {};

  const status = form.get("status");
  if (typeof status === "string" && (STATUS_LIST as readonly string[]).includes(status) && status !== lead.status) {
    set.status = status as Status; edits.push({ field: "status", oldValue: lead.status, newValue: status });
  }
  if (form.has("value")) {
    const v = parseDollars(form.get("value"));
    if (v !== lead.valueCents) { set.valueCents = v; edits.push({ field: "value", oldValue: money(lead.valueCents), newValue: money(v) }); }
  }
  if (form.has("sale")) {
    const v = parseDollars(form.get("sale"));
    if (v !== lead.saleCents) {
      set.saleCents = v; edits.push({ field: "sale", oldValue: money(lead.saleCents), newValue: money(v) });
      if (v && !set.status && lead.status !== "won") { set.status = "won"; edits.push({ field: "status", oldValue: lead.status, newValue: "won" }); }
    }
  }
  if (edits.length) {
    await db.update(schema.leads).set(set).where(eq(schema.leads.id, lead.id));
    await db.insert(schema.leadEdits).values(edits.map((e) => ({ ...e, leadId: lead.id, userId: user.id, userName: user.name ?? user.email })));
  }
  revalidatePath(`/c/${clientId}`, "layout");
  redirect(`/c/${clientId}/leads/${leadId}`);
}

