import { describe, it, expect } from "vitest";
import { resolveSalePrice, RATIO_HIGH_CONFIDENCE_N, SALE_BAND_HALF_WIDTH } from "./salePrice";
import { computeExpectedSale, type CloseListRatio } from "./expectedSale";
import type { AVMResult } from "./types";

const ratio = (over: Partial<CloseListRatio> = {}): CloseListRatio => ({
  ratio: 0.965,
  sampleSize: 60,
  windowMonths: 6,
  scope: "cohort",
  ...over,
});

// Minimal AVMResult fixture — only the fields the resolver reads matter.
const avm = (over: Partial<AVMResult> = {}): AVMResult =>
  ({
    estimatedValue: 1_050_000,
    anchorPrice: 1_000_000,
    totalAdjustmentPct: 0,
    engineMode: "COEFFICIENT_ADJUSTED",
    r2Score: 0.8,
    breakdown: {},
    confidence: "MEDIUM",
    comps: 20,
    nEff: 15,
    basis: "local",
    lowBand: 945_000,
    highBand: 1_155_000,
    predictiveSD: 0.1,
    ...over,
  }) as AVMResult;

describe("resolveSalePrice", () => {
  it("prefers the list-anchored Expected Sale for an active listing with a trustworthy ratio", () => {
    const list = 1_199_000;
    const es = computeExpectedSale(list, ratio({ ratio: 0.965, sampleSize: 60, scope: "cohort" }))!;
    const r = resolveSalePrice({ listPrice: list, isActive: true, expectedSale: es, estimate: avm() })!;
    expect(r.source).toBe("expected-sale");
    expect(r.value).toBe(es.expectedPrice); // list × ratio, NOT the AVM
    expect(r.confidence).toBe("HIGH"); // cohort + n >= RATIO_HIGH_CONFIDENCE_N
    expect(r.deltaVsAskPct).toBeCloseTo((es.expectedPrice - list) / list, 6);
    expect(r.market).toEqual({ ratio: 0.965, sampleSize: 60, scope: "cohort", windowMonths: 6 });
    // AVM survives only as secondary "comparable value" context, never the headline.
    expect(r.comparable).toEqual({ low: 945_000, mid: 1_050_000, high: 1_155_000 });
  });

  it("maps confidence from cohort scope + sample size", () => {
    const list = 1_000_000;
    const mk = (over: Partial<CloseListRatio>) =>
      resolveSalePrice({
        listPrice: list,
        isActive: true,
        expectedSale: computeExpectedSale(list, ratio(over))!,
        estimate: null,
      })!.confidence;
    expect(mk({ scope: "cohort", sampleSize: RATIO_HIGH_CONFIDENCE_N })).toBe("HIGH");
    expect(mk({ scope: "cohort", sampleSize: RATIO_HIGH_CONFIDENCE_N - 1 })).toBe("MEDIUM");
    expect(mk({ scope: "city", sampleSize: RATIO_HIGH_CONFIDENCE_N })).toBe("MEDIUM");
    expect(mk({ scope: "city", sampleSize: 12 })).toBe("LOW");
  });

  it("scales the published band by confidence — wider when the cohort is thin", () => {
    const list = 1_000_000;
    const halfWidth = (over: Partial<CloseListRatio>) => {
      const r = resolveSalePrice({
        listPrice: list,
        isActive: true,
        expectedSale: computeExpectedSale(list, ratio(over))!,
        estimate: null,
      })!;
      return (r.value - r.lowBand) / r.value; // realized half-width
    };
    expect(halfWidth({ scope: "cohort", sampleSize: 60 })).toBeCloseTo(SALE_BAND_HALF_WIDTH.HIGH, 3);
    expect(halfWidth({ scope: "cohort", sampleSize: 20 })).toBeCloseTo(SALE_BAND_HALF_WIDTH.MEDIUM, 3);
    expect(halfWidth({ scope: "city", sampleSize: 20 })).toBeCloseTo(SALE_BAND_HALF_WIDTH.LOW, 3);
    // monotone: a less-supported ratio never gets a tighter range
    expect(SALE_BAND_HALF_WIDTH.HIGH).toBeLessThanOrEqual(SALE_BAND_HALF_WIDTH.MEDIUM);
    expect(SALE_BAND_HALF_WIDTH.MEDIUM).toBeLessThanOrEqual(SALE_BAND_HALF_WIDTH.LOW);
  });

  it("falls back to the AVM when an active listing has no trustworthy ratio", () => {
    const list = 1_000_000;
    const r = resolveSalePrice({ listPrice: list, isActive: true, expectedSale: null, estimate: avm() })!;
    expect(r.source).toBe("avm");
    expect(r.value).toBe(1_050_000);
    expect(r.confidence).toBe("MEDIUM"); // passes through the AVM confidence
    expect(r.market).toBeNull();
    expect(r.comparable).toBeNull();
    expect(r.deltaVsAskPct).toBeCloseTo(0.05, 6); // (1.05M − 1M)/1M
    expect(r.provenance).toMatch(/asking price/i); // explains why it isn't list-anchored
  });

  it("uses the AVM for sold/off-market (no live ask), with no delta when listPrice is absent", () => {
    const r = resolveSalePrice({ listPrice: null, isActive: false, expectedSale: null, estimate: avm() })!;
    expect(r.source).toBe("avm");
    expect(r.deltaVsAskPct).toBeNull();
  });

  it("synthesizes a ±10% band when the AVM bands are missing", () => {
    const r = resolveSalePrice({
      listPrice: 1_000_000,
      isActive: false,
      expectedSale: null,
      estimate: avm({ lowBand: 0, highBand: 0 }),
    })!;
    expect(r.lowBand).toBe(Math.round(1_050_000 * 0.9));
    expect(r.highBand).toBe(Math.round(1_050_000 * 1.1));
  });

  it("does NOT list-anchor when the listing is not active even if a ratio exists", () => {
    const es = computeExpectedSale(1_000_000, ratio())!;
    const r = resolveSalePrice({ listPrice: 1_000_000, isActive: false, expectedSale: es, estimate: avm() })!;
    expect(r.source).toBe("avm");
  });

  it("returns null only when neither method can produce a number", () => {
    expect(resolveSalePrice({ listPrice: 1_000_000, isActive: true, expectedSale: null, estimate: null })).toBeNull();
    expect(
      resolveSalePrice({
        listPrice: null,
        isActive: false,
        expectedSale: null,
        estimate: avm({ estimatedValue: 0, anchorPrice: 0 }),
      })
    ).toBeNull();
  });
});
