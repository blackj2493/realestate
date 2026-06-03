import { describe, it, expect } from "vitest";
import {
  computeExpectedSale,
  axisPosition,
  lineupDomain,
  EXPECTED_SALE_REL_HALF_WIDTH,
  type CloseListRatio,
} from "./expectedSale";

const ratio = (over: Partial<CloseListRatio> = {}): CloseListRatio => ({
  ratio: 0.965,
  sampleSize: 48,
  windowMonths: 6,
  scope: "cohort",
  ...over,
});

describe("computeExpectedSale", () => {
  it("returns null on missing/degenerate inputs", () => {
    expect(computeExpectedSale(1_000_000, null)).toBeNull();
    expect(computeExpectedSale(0, ratio())).toBeNull();
    expect(computeExpectedSale(-5, ratio())).toBeNull();
    expect(computeExpectedSale(1_000_000, ratio({ ratio: 0 }))).toBeNull();
  });

  it("applies the ratio and a symmetric ±band", () => {
    const es = computeExpectedSale(1_199_000, ratio({ ratio: 0.965 }))!;
    expect(es.expectedPrice).toBe(Math.round(1_199_000 * 0.965)); // 1,157,035
    expect(es.lowBand).toBe(Math.round(es.expectedPrice * (1 - EXPECTED_SALE_REL_HALF_WIDTH)));
    expect(es.highBand).toBe(Math.round(es.expectedPrice * (1 + EXPECTED_SALE_REL_HALF_WIDTH)));
    expect(es.lowBand).toBeLessThan(es.expectedPrice);
    expect(es.highBand).toBeGreaterThan(es.expectedPrice);
  });

  it("computes deltaVsAskPct (negative when expected closes below ask)", () => {
    const below = computeExpectedSale(1_000_000, ratio({ ratio: 0.95 }))!;
    expect(below.deltaVsAskPct).toBeCloseTo(-0.05, 6);
    const above = computeExpectedSale(1_000_000, ratio({ ratio: 1.04 }))!;
    expect(above.deltaVsAskPct).toBeCloseTo(0.04, 6);
  });

  it("passes through provenance fields", () => {
    const es = computeExpectedSale(800_000, ratio({ sampleSize: 31, scope: "city", windowMonths: 6 }))!;
    expect(es.sampleSize).toBe(31);
    expect(es.scope).toBe("city");
    expect(es.windowMonths).toBe(6);
  });
});

describe("axisPosition", () => {
  it("maps and clamps to [0,1]", () => {
    expect(axisPosition(150, 100, 200)).toBeCloseTo(0.5, 6);
    expect(axisPosition(100, 100, 200)).toBe(0);
    expect(axisPosition(200, 100, 200)).toBe(1);
    expect(axisPosition(50, 100, 200)).toBe(0); // clamp low
    expect(axisPosition(500, 100, 200)).toBe(1); // clamp high
  });
  it("returns 0.5 for a degenerate domain", () => {
    expect(axisPosition(100, 100, 100)).toBe(0.5);
  });
});

describe("lineupDomain", () => {
  it("spans the points with padding so end markers aren't clipped", () => {
    const d = lineupDomain([1_000_000, 1_100_000, 1_200_000]);
    expect(d.min).toBeLessThan(1_000_000);
    expect(d.max).toBeGreaterThan(1_200_000);
  });
  it("ignores non-positive/non-finite points", () => {
    const d = lineupDomain([0, NaN, 900_000, 1_100_000]);
    expect(d.min).toBeLessThan(900_000);
    expect(d.min).toBeGreaterThan(0);
    expect(d.max).toBeGreaterThan(1_100_000);
  });
  it("handles a single point without collapsing", () => {
    const d = lineupDomain([1_000_000]);
    expect(d.min).toBeLessThan(1_000_000);
    expect(d.max).toBeGreaterThan(1_000_000);
  });
});
