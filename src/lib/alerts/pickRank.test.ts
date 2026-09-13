import { describe, expect, it } from "vitest";
import {
  comparePicks,
  pickScore,
  sanePriceCut,
  PICK_GAP_CEILING,
  PICK_MIN_CUT,
} from "./pickRank";

const est = (estimatedValue: number | null, confidence: string | null) => ({
  estimatedValue,
  confidence,
});

describe("pickScore", () => {
  it("scores a home asking under a trusted estimate", () => {
    expect(pickScore(800_000, est(1_000_000, "HIGH"))).toBeCloseTo(0.2, 5);
    expect(pickScore(900_000, est(1_000_000, "MEDIUM"))).toBeCloseTo(0.1, 5);
  });

  it("refuses LOW confidence and a missing estimate", () => {
    // 284 of 1,598 estimates on one night were LOW. Ranking on those is ranking on noise.
    expect(pickScore(800_000, est(1_000_000, "LOW"))).toBeNull();
    expect(pickScore(800_000, est(null, "HIGH"))).toBeNull();
    expect(pickScore(800_000, null)).toBeNull();
    expect(pickScore(800_000, undefined)).toBeNull();
  });

  it("refuses a home asking at or above its estimate", () => {
    // The median new listing asks ~8% ABOVE the estimate, so this is the common case,
    // not an edge one — it must sort behind, never lead.
    expect(pickScore(1_000_000, est(1_000_000, "HIGH"))).toBeNull();
    expect(pickScore(1_300_000, est(1_000_000, "HIGH"))).toBeNull();
  });

  it("refuses a gap too wide to believe", () => {
    // Past the ceiling it is the AVM meeting something it cannot model — a leasehold, a
    // co-op, a tear-down priced as land. p99 of the real distribution is 25.8%.
    const justUnder = 1_000_000 * (1 - PICK_GAP_CEILING) + 1;
    const justOver = 1_000_000 * (1 - PICK_GAP_CEILING) - 1;
    expect(pickScore(justUnder, est(1_000_000, "HIGH"))).not.toBeNull();
    expect(pickScore(justOver, est(1_000_000, "HIGH"))).toBeNull();
  });

  it("refuses a missing or nonsense list price", () => {
    expect(pickScore(null, est(1_000_000, "HIGH"))).toBeNull();
    expect(pickScore(0, est(1_000_000, "HIGH"))).toBeNull();
  });
});

describe("sanePriceCut", () => {
  it("keeps a real cut", () => {
    expect(sanePriceCut(45_000, 900_000)).toBe(45_000);
  });

  it("drops a cut too small to be news", () => {
    expect(sanePriceCut(PICK_MIN_CUT - 1, 900_000)).toBeNull();
    expect(sanePriceCut(0, 900_000)).toBeNull();
    expect(sanePriceCut(null, 900_000)).toBeNull();
  });

  it("drops a relist artifact", () => {
    // TotalPriceDrop runs to 164% of the ask in the live index; 48 of 526 cut listings on
    // one night cleared 25%. Those are relists under a reused key, not price cuts.
    expect(sanePriceCut(1_300_000, 1_999_000)).toBeNull();
    expect(sanePriceCut(900_000, 800_000)).toBeNull();
  });
});

describe("comparePicks", () => {
  it("puts the best-priced first and falls back to newest", () => {
    const rows = [
      { listing_key: "A", score: null, entryMs: 500 },
      { listing_key: "B", score: 0.05, entryMs: 100 },
      { listing_key: "C", score: 0.22, entryMs: 1 },
      { listing_key: "D", score: null, entryMs: 900 },
    ];
    expect([...rows].sort(comparePicks).map((r) => r.listing_key)).toEqual(["C", "B", "D", "A"]);
  });

  it("leaves an unscored area in newest-first order", () => {
    // Commercial, land, a thin rural cohort: no estimates at all, so nothing changes.
    const rows = [
      { listing_key: "A", entryMs: 1 },
      { listing_key: "B", entryMs: 3 },
      { listing_key: "C", entryMs: 2 },
    ];
    expect([...rows].sort(comparePicks).map((r) => r.listing_key)).toEqual(["B", "C", "A"]);
  });
});
