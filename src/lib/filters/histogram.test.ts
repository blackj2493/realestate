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
