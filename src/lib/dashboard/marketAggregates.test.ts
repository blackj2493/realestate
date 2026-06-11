import { describe, expect, it } from "vitest";
import {
  assembleRegionScore,
  smoothedYoY,
  temperatureOf,
  type PriceTrendResp,
  type RegionStatsResp,
  type TrendPoint,
} from "./marketAggregates";

function pt(month: string, medianPrice: number, medianPpsf: number | null, sales: number): TrendPoint {
  return { month, medianPrice, medianPpsf, sales };
}

function trendResp(overrides: Partial<PriceTrendResp> = {}): PriceTrendResp {
  return {
    region: "Testville",
    points: [],
    summary: {
      soldToListPct: null,
      pctOverAsking: null,
      listPriceCoverage: 0,
      sales90: 0,
      monthlyVelocity: null,
    },
    ...overrides,
  };
}

function statsResp(overrides: Partial<RegionStatsResp["stats"]> = {}, locked = false): RegionStatsResp {
  return {
    region: "Testville",
    stats: {
      activeCount: 0,
      capSample: 0,
      medianCapRate: null,
      avgCapRate: null,
      topCapRate: null,
      staleCount: 0,
      ...overrides,
    },
    ...(locked ? { locked: true } : {}),
  };
}

describe("temperatureOf", () => {
  it("is null when either input is missing", () => {
    expect(temperatureOf(null, 100)).toBeNull();
    expect(temperatureOf(2, null)).toBeNull();
  });

  it("classifies hot / balanced / cold", () => {
    expect(temperatureOf(1.5, 101)).toBe("hot");
    expect(temperatureOf(3, 98)).toBe("balanced");
    expect(temperatureOf(5, 99)).toBe("cold"); // high supply
    expect(temperatureOf(2.5, 95)).toBe("cold"); // weak sold-to-list
  });
});

describe("assembleRegionScore", () => {
  it("returns an all-null score when both responses are missing", () => {
    const s = assembleRegionScore("Testville", null, null);
    expect(s.region).toBe("Testville");
    expect(s.locked).toBe(false);
    expect(s.medianPrice).toBeNull();
    expect(s.monthsOfSupply).toBeNull();
    expect(s.temperature).toBeNull();
    expect(s.priceSeries).toEqual([]);
  });

  it("propagates the locked shape from either endpoint", () => {
    expect(assembleRegionScore("T", trendResp({ locked: true }), statsResp()).locked).toBe(true);
    expect(assembleRegionScore("T", trendResp(), statsResp({}, true)).locked).toBe(true);
  });

  it("derives months of supply from active count / monthly velocity", () => {
    const trend = trendResp({
      points: [pt("2026-05", 900_000, 600, 30)],
      summary: {
        soldToListPct: 99,
        pctOverAsking: 30,
        listPriceCoverage: 1,
        sales90: 90,
        monthlyVelocity: 30,
      },
    });
    const s = assembleRegionScore("T", trend, statsResp({ activeCount: 90 }));
    expect(s.monthsOfSupply).toBe(3);
    expect(s.temperature).toBe("balanced");
    expect(s.medianPrice).toBe(900_000);
    expect(s.medianPpsf).toBe(600);
  });

  it("leaves months of supply null when velocity is missing or zero", () => {
    const s = assembleRegionScore("T", trendResp(), statsResp({ activeCount: 50 }));
    expect(s.monthsOfSupply).toBeNull();
    expect(s.temperature).toBeNull();
  });

  it("suppresses median cap rate below the 5-listing sample floor", () => {
    const withSmall = assembleRegionScore(
      "T",
      trendResp(),
      statsResp({ capSample: 4, medianCapRate: 6.1 })
    );
    expect(withSmall.medianCapRate).toBeNull();
    const withEnough = assembleRegionScore(
      "T",
      trendResp(),
      statsResp({ capSample: 5, medianCapRate: 6.1 })
    );
    expect(withEnough.medianCapRate).toBe(6.1);
  });

  it("computes stale share off the active count", () => {
    const s = assembleRegionScore("T", trendResp(), statsResp({ activeCount: 200, staleCount: 30 }));
    expect(s.stalePct).toBe(15);
  });

  it("uses the latest month for median price and last non-null ppsf", () => {
    const trend = trendResp({
      points: [
        pt("2026-03", 800_000, 580, 20),
        pt("2026-04", 850_000, 590, 25),
        pt("2026-05", 870_000, null, 22), // ppsf gap in the latest month
      ],
    });
    const s = assembleRegionScore("T", trend, null);
    expect(s.medianPrice).toBe(870_000);
    expect(s.medianPpsf).toBe(590);
    expect(s.priceSeries.map((p) => p.month)).toEqual(["2026-03", "2026-04", "2026-05"]);
  });
});

describe("smoothedYoY", () => {
  it("aligns by month label, not array index", () => {
    // 10% flat YoY across the three latest months; an omitted month in between
    // must not shift the comparison window.
    const points: TrendPoint[] = [
      pt("2025-03", 1_000_000, null, 10),
      pt("2025-04", 1_000_000, null, 10),
      pt("2025-05", 1_000_000, null, 10),
      // 2025-06..2026-02 omitted (zero-sale months are absent from the API)
      pt("2026-03", 1_100_000, null, 10),
      pt("2026-04", 1_100_000, null, 10),
      pt("2026-05", 1_100_000, null, 10),
    ];
    expect(smoothedYoY(points, "medianPrice")).toBe(10);
  });

  it("returns null when a prior-year month is missing", () => {
    const points: TrendPoint[] = [
      pt("2026-03", 1_100_000, null, 10),
      pt("2026-04", 1_100_000, null, 10),
      pt("2026-05", 1_100_000, null, 10),
    ];
    expect(smoothedYoY(points, "medianPrice")).toBeNull();
  });
});
