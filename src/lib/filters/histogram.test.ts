import { describe, it, expect } from "vitest";
import { buildBands, bandFilter, supportsHistogram } from "./histogram";

describe("histogram — buildBands", () => {
  it("splits into n equal bands with an open-ended top", () => {
    const bands = buildBands(0, 1000, 4);
    expect(bands).toEqual([
      { lo: 0, hi: 250 },
      { lo: 250, hi: 500 },
      { lo: 500, hi: 750 },
      { lo: 750, hi: null }, // open-ended captures the tail (e.g. > max)
    ]);
  });
  it("returns [] for degenerate input", () => {
    expect(buildBands(0, 0, 4)).toEqual([]);
    expect(buildBands(0, 1000, 0)).toEqual([]);
  });
});

describe("histogram — bandFilter", () => {
  it("emits a half-open range for interior bands", () => {
    expect(bandFilter("ListPrice", { lo: 250000, hi: 500000 })).toBe(
      "ListPrice:>=250000 && ListPrice:<500000"
    );
  });
  it("emits a single lower bound for the open-ended top band", () => {
    expect(bandFilter("ListPrice", { lo: 2850000, hi: null })).toBe("ListPrice:>=2850000");
  });
});

describe("histogram — bandFilter respects the field's schema type", () => {
  // int32 fields reject a decimal ("Not an int32"), so an int32 edge snaps up to the
  // smallest integer the half-open band still contains.
  it("snaps an int32 edge up, so a sub-integer band asks for the integers it holds", () => {
    expect(bandFilter("TrueDom", { lo: 0, hi: 0.6 })).toBe("TrueDom:>=0 && TrueDom:<1");
    expect(bandFilter("TrueDom", { lo: 0.6, hi: 1.2 })).toBe("TrueDom:>=1 && TrueDom:<2");
    // [1.2, 1.8) holds no integer — an empty clause here is the correct answer.
    expect(bandFilter("TrueDom", { lo: 1.2, hi: 1.8 })).toBe("TrueDom:>=2 && TrueDom:<2");
  });

  it("keeps the real edge on a float field", () => {
    // The cap rate slider (0–12 over 20 bands) steps by 0.6. Flooring both edges used
    // to emit `cap_rate_est:>=1 && cap_rate_est:<1` — an impossible range — for 8 of
    // the 20 bars, and shifted the survivors a full point off their labels.
    expect(bandFilter("cap_rate_est", { lo: 1.2, hi: 1.8 })).toBe(
      "cap_rate_est:>=1.2 && cap_rate_est:<1.8"
    );
    expect(bandFilter("cap_rate_est", { lo: 11.4, hi: null })).toBe("cap_rate_est:>=11.4");
  });

  it("trims binary-float noise from a float edge", () => {
    const bands = buildBands(0, 12, 20);
    expect(bandFilter("cap_rate_est", bands[3])).toBe(
      "cap_rate_est:>=1.8 && cap_rate_est:<2.4" // not 1.7999999999999998
    );
  });

  it("tiles the cap rate slider with no empty or duplicated band", () => {
    const bands = buildBands(0, 12, 20);
    const clauses = bands.map((b) => bandFilter("cap_rate_est", b));
    expect(new Set(clauses).size).toBe(clauses.length); // every band distinct
    // No band may collapse to an impossible `>=x && <x` range.
    const collapsed = bands.filter((b) => b.hi !== null && b.hi <= b.lo);
    expect(collapsed).toEqual([]);
    // Each band's upper edge is the next band's lower edge — no gap, no overlap.
    const lowerEdge = (c: string) => c.split(" && ")[0].split(":>=")[1];
    const upperEdge = (c: string) => c.split(" && ")[1]?.split(":<")[1];
    for (let i = 1; i < clauses.length; i++) {
      expect(lowerEdge(clauses[i])).toBe(upperEdge(clauses[i - 1]));
    }
  });
});

describe("histogram — supportsHistogram", () => {
  it("accepts indexed numeric fields", () => {
    expect(supportsHistogram("ListPrice")).toBe(true);
    expect(supportsHistogram("LotWidth")).toBe(true);
    expect(supportsHistogram("AssociationFee")).toBe(true); // indexed 2026-06-01
  });
  it("rejects unindexed / unknown fields", () => {
    expect(supportsHistogram("TaxAnnualAmount")).toBe(false); // index:false cargo
    expect(supportsHistogram(undefined)).toBe(false);
  });
});

describe("histogram supports the real cap/yield fields", () => {
  it("includes cap_rate_est and gross_yield_est", () => {
    expect(supportsHistogram("cap_rate_est")).toBe(true);
    expect(supportsHistogram("gross_yield_est")).toBe(true);
  });
});
