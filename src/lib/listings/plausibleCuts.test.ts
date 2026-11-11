import { describe, expect, it } from "vitest";
import { isPlausibleCut, plausibleCuts, shownCut } from "./plausibleCuts";

describe("plausibleCuts", () => {
  it("drops a cut built on a typo in the original price", () => {
    // $68,999,000 -> $649,990: the feed case from 2026-11-10
    expect(plausibleCuts([{ ListPrice: 649_990, TotalPriceDrop: 68_349_010 }])).toEqual([]);
  });

  it("keeps a normal cut and keeps the input order", () => {
    const a = { ListPrice: 1_180_000, TotalPriceDrop: 120_000 }; // ~9.2%
    const b = { ListPrice: 899_000, TotalPriceDrop: 50_000 }; // ~5.3%
    expect(plausibleCuts([a, b])).toEqual([a, b]);
  });

  it("drops cuts below 2% and above 25%", () => {
    expect(plausibleCuts([{ ListPrice: 1_000_000, TotalPriceDrop: 5_000 }])).toEqual([]);
    expect(plausibleCuts([{ ListPrice: 600_000, TotalPriceDrop: 400_000 }])).toEqual([]);
  });

  it("drops records with no drop or no price", () => {
    expect(plausibleCuts([{ ListPrice: 500_000, TotalPriceDrop: 0 }, { ListPrice: null, TotalPriceDrop: 20_000 }, {}])).toEqual([]);
  });
});

describe("isPlausibleCut", () => {
  it("accepts 2-25% and rejects typos, zero, and missing values", () => {
    expect(isPlausibleCut(50_000, 950_000)).toBe(true); // 5%
    expect(isPlausibleCut(68_349_010, 649_990)).toBe(false);
    expect(isPlausibleCut(1_000, 999_000)).toBe(false); // 0.1%
    expect(isPlausibleCut(0, 500_000)).toBe(false);
    expect(isPlausibleCut(undefined, 500_000)).toBe(false);
    expect(isPlausibleCut(50_000, null)).toBe(false);
  });
});

describe("shownCut", () => {
  it("shows small and normal cuts as they are", () => {
    expect(shownCut(5_000, 995_000)).toBe(5_000);
    expect(shownCut(120_000, 1_180_000)).toBe(120_000);
  });
  it("hides a typo or relist-artifact cut", () => {
    expect(shownCut(68_349_010, 649_990)).toBe(0);
    expect(shownCut(500_000, 500_000)).toBe(0);
  });
  it("returns 0 for missing values", () => {
    expect(shownCut(null, 500_000)).toBe(0);
    expect(shownCut(10_000, 0)).toBe(0);
  });
});
