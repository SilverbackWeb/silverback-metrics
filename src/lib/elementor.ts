/**
 * Parse an Elementor Pro Forms "Webhook" action payload.
 *
 * Elementor posts application/x-www-form-urlencoded. With "Advanced Data" ON
 * (recommended) keys look like:
 *   form[id], form[name],
 *   fields[<id>][id|type|title|value|raw_value|required],
 *   meta[<key>][title|value]   (date, time, page_url, user_agent, remote_ip)
 * With it OFF, keys are just field labels ("Name", "Email", ...) plus
 * "Date", "Time", "Page URL", "User Agent", "Remote IP", "Powered by".
 */
import { parseSbData, type SbData } from "./attribution";

export type ParsedField = { id: string; type?: string; label?: string; value: string };

export type ParsedLead = {
  formId?: string;
  formName?: string;
  pageUrl?: string;
  remoteIp?: string;
  userAgent?: string;
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  fields: ParsedField[];
  attribution: SbData | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SKIP_SIMPLE = new Set(["date", "time", "page url", "user agent", "remote ip", "powered by", "form_id", "form_name"]);

export function parseElementor(input: URLSearchParams | Record<string, unknown>): ParsedLead {
  const flat: Record<string, string> = {};
  if (input instanceof URLSearchParams) {
    input.forEach((v, k) => (flat[k] = v));
  } else {
    flattenInto(flat, input, "");
  }

  const isAdvanced = Object.keys(flat).some((k) => k.startsWith("fields["));
  const lead: ParsedLead = { fields: [], attribution: null };

  if (isAdvanced) {
    lead.formId = flat["form[id]"];
    lead.formName = flat["form[name]"];
    lead.pageUrl = flat["meta[page_url][value]"];
    lead.remoteIp = flat["meta[remote_ip][value]"];
    lead.userAgent = flat["meta[user_agent][value]"];
    const byId = new Map<string, ParsedField>();
    for (const [k, v] of Object.entries(flat)) {
      const m = k.match(/^fields\[([^\]]+)\]\[([^\]]+)\]$/);
      if (!m) continue;
      const [, id, prop] = m;
      const f = byId.get(id) ?? { id, value: "" };
      if (prop === "type") f.type = v;
      else if (prop === "title") f.label = v;
      else if (prop === "raw_value") f.value = v;
      else if (prop === "value" && !f.value) f.value = v;
      byId.set(id, f);
    }
    lead.fields = [...byId.values()];
  } else {
    lead.formId = flat["form_id"];
    lead.formName = flat["form_name"];
    lead.pageUrl = flat["Page URL"];
    lead.remoteIp = flat["Remote IP"];
    lead.userAgent = flat["User Agent"];
    for (const [k, v] of Object.entries(flat)) {
      if (SKIP_SIMPLE.has(k.toLowerCase())) continue;
      lead.fields.push({ id: k, label: k, value: v });
    }
  }

  // Attribution: the sb_data hidden field (by ID, label, or by content shape).
  const sbField =
    lead.fields.find((f) => f.id === "sb_data" || f.label === "sb_data") ??
    lead.fields.find((f) => parseSbData(f.value) !== null);
  if (sbField) lead.attribution = parseSbData(sbField.value);

  const visible = lead.fields.filter((f) => f !== sbField && f.type !== "hidden");
  const key = (f: ParsedField) => `${f.id} ${f.label ?? ""}`.toLowerCase();

  lead.email = visible.find((f) => f.type === "email" || (key(f).includes("email") && EMAIL_RE.test(f.value)))?.value;
  lead.phone = visible.find((f) => f.type === "tel" || /phone|tel|mobile|cell/.test(key(f)))?.value;
  lead.message = visible.find((f) => f.type === "textarea" || /message|comment|details|project|how can/.test(key(f)))?.value;
  const first = visible.find((f) => /first/.test(key(f)) && /name/.test(key(f)))?.value;
  const last = visible.find((f) => /last/.test(key(f)) && /name/.test(key(f)))?.value;
  lead.name =
    first || last
      ? [first, last].filter(Boolean).join(" ")
      : visible.find((f) => /name/.test(key(f)) && !/company|business/.test(key(f)))?.value;

  return lead;
}

function flattenInto(out: Record<string, string>, obj: unknown, prefix: string) {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== "object") {
    out[prefix] = String(obj);
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    flattenInto(out, v, prefix ? `${prefix}[${k}]` : k);
  }
}

/** Cheap spam signals. Leads are flagged, never dropped. */
export function spamScore(lead: ParsedLead): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const text = `${lead.name ?? ""} ${lead.message ?? ""}`;
  if ((text.match(/https?:\/\//g) ?? []).length >= 2) reasons.push("multiple links");
  if (/\b(seo services|backlinks|crypto|casino|viagra|guest post|rank your website)\b/i.test(text)) reasons.push("spam keywords");
  if (lead.email && !EMAIL_RE.test(lead.email)) reasons.push("invalid email");
  if (!lead.attribution) reasons.push("no tracking data (bot or snippet missing)");
  if (/[Ѐ-ӿ一-鿿]/.test(text)) reasons.push("unexpected script");
  return { score: reasons.length, reasons };
}
