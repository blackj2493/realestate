import { describe, expect, it } from "vitest";
import { plausibleCuts } from "./plausibleCuts";

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
