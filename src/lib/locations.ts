/** Turn what people type ("Kirkwood, MO") into DataForSEO's location name ("Kirkwood,Missouri,United States"). */
const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bSt\b\.?/g, "Saint");

export function normalizeLocation(input: string): string | null {
  const parts = input.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length >= 3) return parts.join(",");
  const city = title(parts[0]);
  if (parts.length === 1) return city;
  const st = parts[1].toUpperCase().replace(/\./g, "");
  return `${city},${STATES[st] ?? title(parts[1])},United States`;
}
export const city = (loc: string) => loc.split(",")[0];
