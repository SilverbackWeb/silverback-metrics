// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const code = fs.readFileSync(path.resolve(__dirname, "../public/t.js"), "utf8");

function runSnippet(url: string, referrer = "") {
  window.history.replaceState(null, "", url);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
  const s = document.createElement("script");
  s.setAttribute("data-site", "KEY123");
  Object.defineProperty(s, "src", { value: "https://metrics.example.com/t.js" });
  Object.defineProperty(document, "currentScript", { value: s, configurable: true });
  new Function(code)();
}

describe("t.js", () => {
  let beacons: any[];
  beforeEach(() => {
    localStorage.clear();
    document.cookie.split(";").forEach((c) => (document.cookie = c.split("=")[0] + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"));
    document.body.innerHTML = `<form id="f"><input name="form_fields[name]" value="Jane"><input type="hidden" name="form_fields[sb_data]"><input type="hidden" name="form_fields[utm_source]"></form>`;
    beacons = [];
    (navigator as any).sendBeacon = vi.fn((_u: string, blob: Blob) => { beacons.push(blob); return true; });
  });

  it("captures UTMs, fills sb_data, keeps first touch and last non-direct touch", async () => {
    runSnippet("/?utm_source=google&utm_medium=gbp&utm_campaign=gbp-listing", "https://www.google.com/");
    const field = document.querySelector<HTMLInputElement>('input[name="form_fields[sb_data]"]')!;
    const d1 = JSON.parse(field.value);
    expect(d1.ft.utm_campaign).toBe("gbp-listing");
    expect(d1.lt.utm_campaign).toBe("gbp-listing");
    expect(document.querySelector<HTMLInputElement>('input[name="form_fields[utm_source]"]')!.value).toBe("google");

    // Second visit via an ad
    runSnippet("/services/?gclid=ABC", "https://www.google.com/");
    const d2 = JSON.parse(field.value);
    expect(d2.vid).toBe(d1.vid);
    expect(d2.ft.utm_campaign).toBe("gbp-listing");
    expect(d2.lt.gclid).toBe("ABC");

    // Third visit, direct: last touch stays the ad
    runSnippet("/about/", "");
    const d3 = JSON.parse(field.value);
    expect(d3.lt.gclid).toBe("ABC");

    const sent = await Promise.all(beacons.map((b) => new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsText(b); })));
    const types = sent.map((t) => JSON.parse(t).type);
    expect(types).toContain("pageview");
    expect(types).toContain("field_found");
  });
});
