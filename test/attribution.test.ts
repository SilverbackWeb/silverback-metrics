import { describe, expect, it } from "vitest";
import { classify, sourceMedium } from "@/lib/attribution";

describe("classify", () => {
  it.each([
    [{ gclid: "abc" }, "google_ads"],
    [{ utm_source: "google", utm_medium: "cpc", utm_campaign: "123" }, "google_ads"],
    [{ utm_source: "google", utm_medium: "gbp", utm_campaign: "gbp-listing" }, "gbp"],
    [{ utm_source: "facebook", utm_medium: "paid_social" }, "paid_social"],
    [{ fbclid: "x" }, "paid_social"],
    [{ msclkid: "x" }, "microsoft_ads"],
    [{ utm_source: "newsletter", utm_medium: "email" }, "email"],
    [{ utm_source: "test", utm_medium: "test" }, "other_campaign"],
    [{ referrer: "https://www.google.com/" }, "organic_search"],
    [{ referrer: "https://www.bing.com/search?q=x" }, "organic_search"],
    [{ referrer: "https://m.facebook.com/" }, "organic_social"],
    [{ referrer: "https://www.houzz.com/pro/x" }, "referral"],
    [{ direct: true }, "direct"],
    [null, "direct"],
  ] as const)("%j -> %s", (touch, expected) => {
    expect(classify(touch)).toBe(expected);
  });
});

describe("sourceMedium", () => {
  it("formats utm and referrer touches", () => {
    expect(sourceMedium({ utm_source: "google", utm_medium: "gbp" })).toBe("google / gbp");
    expect(sourceMedium({ referrer: "https://www.google.com/" })).toBe("google.com / organic");
    expect(sourceMedium({ gclid: "x" })).toBe("google / cpc");
    expect(sourceMedium(undefined)).toBe("(direct) / (none)");
  });
});
