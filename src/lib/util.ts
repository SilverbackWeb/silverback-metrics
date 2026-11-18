export function cleanDomain(input: string) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

/** "$1,250" / "1250" / "" -> cents or null. */
export function parseDollars(v: FormDataEntryValue | string | null | undefined): number | null {
  const s = String(v ?? "").replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
