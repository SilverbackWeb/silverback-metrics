import { describe, expect, it } from "vitest";
import { parseElementor, spamScore } from "@/lib/elementor";

const sb = JSON.stringify({ v: 1, vid: "11111111-1111-4111-8111-111111111111", ft: { referrer: "https://www.google.com/" }, lt: { utm_source: "google", utm_medium: "cpc", gclid: "G123" } });

describe("parseElementor", () => {
  it("parses Advanced Data payloads", () => {
    const p = new URLSearchParams({
      "form[id]": "a1b2", "form[name]": "Contact",
      "fields[name][id]": "name", "fields[name][type]": "text", "fields[name][title]": "Name", "fields[name][value]": "Jane Doe", "fields[name][raw_value]": "Jane Doe",
      "fields[email][id]": "email", "fields[email][type]": "email", "fields[email][title]": "Email", "fields[email][value]": "jane@example.com",
      "fields[field_2][id]": "field_2", "fields[field_2][type]": "tel", "fields[field_2][title]": "Phone", "fields[field_2][value]": "(636) 555-0100",
      "fields[message][id]": "message", "fields[message][type]": "textarea", "fields[message][title]": "Message", "fields[message][value]": "Need a quote for siding",
      "fields[sb_data][id]": "sb_data", "fields[sb_data][type]": "hidden", "fields[sb_data][title]": "", "fields[sb_data][value]": sb,
      "meta[page_url][title]": "Page URL", "meta[page_url][value]": "https://client.com/contact/",
    });
    const lead = parseElementor(p);
    expect(lead).toMatchObject({ formName: "Contact", name: "Jane Doe", email: "jane@example.com", phone: "(636) 555-0100", message: "Need a quote for siding", pageUrl: "https://client.com/contact/" });
    expect(lead.attribution?.lt?.gclid).toBe("G123");
    expect(spamScore(lead).score).toBe(0);
  });

  it("parses simple payloads and finds sb_data by shape", () => {
    const p = new URLSearchParams({ "First Name": "Bob", "Last Name": "Smith", "Email Address": "bob@x.com", "No Label sb_data": sb, "Page URL": "https://client.com/" });
    const lead = parseElementor(p);
    expect(lead.name).toBe("Bob Smith");
    expect(lead.email).toBe("bob@x.com");
    expect(lead.attribution?.vid).toMatch(/^1111/);
  });

  it("flags obvious spam", () => {
    const lead = parseElementor(new URLSearchParams({ Name: "x", Message: "Best SEO services http://a.com http://b.com" }));
    expect(spamScore(lead).score).toBeGreaterThanOrEqual(2);
  });
});
