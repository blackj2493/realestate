import { describe, it, expect } from "vitest";
import { toLeaderboardRow, type MarketSummary } from "./marketSummary";

const summary = (over: Partial<MarketSummary>): MarketSummary => ({
  region: "Toronto",
  activeCount: 1000,
  staleCount: 120,
  capSample: 50,
  medianCapRate: 4.2,
  avgCapRate: 4.5,
  topCapRate: 9.1,
  trend: null,
  computedAt: "2026-06-27T03:00:00Z",
  ...over,
});

describe("toLeaderboardRow", () => {
  it("computes % stale of active and passes median cap when the sample is meaningful", () => {
    const row = toLeaderboardRow("Toronto", summary({}));
    expect(row.activeCount).toBe(1000);
    expect(row.stalePct).toBe(12); // 120/1000 = 12.0%
    expect(row.medianCapRate).toBe(4.2);
  });

  it("rounds stalePct to one decimal", () => {
    const row = toLeaderboardRow("Hamilton", summary({ activeCount: 333, staleCount: 100 }));
    expect(row.stalePct).toBe(30); // 100/333 = 30.03% → 30.0
  });

  it("suppresses median cap rate when the priced sample is below 5", () => {
    expect(toLeaderboardRow("Milton", summary({ capSample: 4 })).medianCapRate).toBeNull();
    expect(toLeaderboardRow("Milton", summary({ capSample: 5 })).medianCapRate).toBe(4.2);
  });

  it("null stalePct when there are no active listings", () => {
    const row = toLeaderboardRow("Whitby", summary({ activeCount: 0, staleCount: 0 }));
    expect(row.stalePct).toBeNull();
  });

  it("returns an all-null row when a market has no summary yet", () => {
    expect(toLeaderboardRow("Ajax", undefined)).toEqual({
      region: "Ajax",
      activeCount: null,
      stalePct: null,
      medianCapRate: null,
    });
  });
});
