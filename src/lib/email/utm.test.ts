import { describe, expect, it } from "vitest";
import { withUtm, utmTagger } from "./utm";

/**
 * What these guard: the Data Drop shipped with bare URLs, so its stated KPI — "click to
 * terminal above 8%" (plan §9) — was unmeasurable. Attribution has to ride the link, and
 * these are the ways tagging a link can silently damage it.
 */
describe("withUtm", () => {
  const tags = { source: "data_drop", campaign: "2026-W36", content: "cta" };

  it("adds the four parameters", () => {
    const out = new URL(withUtm("https://www.pureproperty.ca/data/price-cuts", tags));
    expect(out.searchParams.get("utm_source")).toBe("data_drop");
    expect(out.searchParams.get("utm_medium")).toBe("email");
    expect(out.searchParams.get("utm_campaign")).toBe("2026-w36");
    expect(out.searchParams.get("utm_content")).toBe("cta");
  });

  it("keeps the query a camera deep link already carries", () => {
    // The terminal CTA is `?lat=&lng=&z=`. Losing any of those drops the reader on a
    // default map instead of their market — see src/lib/dataDrop/cameras.ts.
    const out = new URL(
      withUtm("https://www.pureproperty.ca/properties?lat=43.51&lng=-79.88&z=11", tags)
    );
    expect(out.searchParams.get("lat")).toBe("43.51");
    expect(out.searchParams.get("lng")).toBe("-79.88");
    expect(out.searchParams.get("z")).toBe("11");
    expect(out.searchParams.get("utm_medium")).toBe("email");
  });

  it("is idempotent — a link cannot accumulate two utm_source values", () => {
    const once = withUtm("https://www.pureproperty.ca/data", tags);
    const twice = withUtm(once, tags);
    expect(twice).toBe(once);
    expect(twice.match(/utm_source/g)).toHaveLength(1);
  });

  it("slugs the content so one market is not two rows in a report", () => {
    const out = new URL(
      withUtm("https://www.pureproperty.ca/properties", { ...tags, content: "chip-Richmond Hill" })
    );
    expect(out.searchParams.get("utm_content")).toBe("chip-richmond-hill");
  });

  it("returns a relative or malformed href unchanged rather than throwing", () => {
    // A renderer must never fail a whole send over one link it could not parse.
    expect(withUtm("/data/price-cuts", tags)).toBe("/data/price-cuts");
    expect(withUtm("", tags)).toBe("");
  });

  it("preserves a base64url signature through the round trip", () => {
    // base64url has no `+`, but URLSearchParams decodes `+` as a space, so any future move
    // to plain base64 would corrupt an HMAC here. This is the canary for that.
    const sig = "abc-_123XYZ";
    const out = new URL(
      withUtm(`https://www.pureproperty.ca/api/x?e=a%40b.com&s=${sig}`, tags)
    );
    expect(out.searchParams.get("s")).toBe(sig);
    expect(out.searchParams.get("e")).toBe("a@b.com");
  });
});

describe("utmTagger", () => {
  it("binds source and campaign, leaving content per link", () => {
    const tag = utmTagger("data_drop", "2026-W36");
    const a = new URL(tag("https://www.pureproperty.ca/data/price-cuts", "tracker-price-cuts"));
    const b = new URL(tag("https://www.pureproperty.ca/properties", "cta"));
    expect(a.searchParams.get("utm_campaign")).toBe("2026-w36");
    expect(b.searchParams.get("utm_campaign")).toBe("2026-w36");
    expect(a.searchParams.get("utm_content")).toBe("tracker-price-cuts");
    expect(b.searchParams.get("utm_content")).toBe("cta");
  });
});
