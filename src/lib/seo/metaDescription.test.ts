import { describe, expect, it } from "vitest";
import { META_DESCRIPTION_MAX, metaDescription } from "./metaDescription";

describe("metaDescription", () => {
  it("leaves a short description as it is", () => {
    expect(metaDescription("Sold prices in Toronto, updated nightly.")).toBe("Sold prices in Toronto, updated nightly.");
    expect(metaDescription(null)).toBe("");
  });

  it("keeps the whole sentences that fit", () => {
    const a = "Toronto's typical home sold for $1.12M in October, down 3.1% from a year earlier.";
    const b = "Homes took 24 days to sell, and 41% of them sold below the asking price at the close.";
    const c = "From MLS® data, updated nightly.";
    const out = metaDescription(`${a} ${b} ${c}`);
    expect(out).toBe(a);
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
  });

  it("does not split a sentence at a decimal point", () => {
    const out = metaDescription(`Prices fell 3.1% and the median hit $1.12M. ${"More text here. ".repeat(12)}`);
    expect(out.startsWith("Prices fell 3.1% and the median hit $1.12M.")).toBe(true);
  });

  it("cuts one long sentence at a word and adds an ellipsis", () => {
    const out = metaDescription(`${"word ".repeat(60)}end.`);
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(out.endsWith("word…")).toBe(true);
  });
});
