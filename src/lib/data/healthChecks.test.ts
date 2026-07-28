import { describe, it, expect } from "vitest";
import {
  checkMarketRows,
  checkCondoRows,
  checkMigrationLedger,
  checkPriceLedger,
  checkDrift,
  checkEmailFailures,
  snapshotFromRows,
  LATEST_MONTH_KEY,
  type Problem,
  type SnapshotEntry,
} from "@/lib/data/healthChecks";
import type { MarketRow } from "@/lib/data/marketBoard";
import type { CondoAreaRow } from "@/lib/data/condoFeeBoard";

/**
 * Regression suite for the data-health canary.
 *
 * Each case REPLAYS a real silent failure from July 2026. A monitor nobody has watched fail
 * proves nothing, so every historical bug gets a test asserting the canary catches it —
 * and a matching "healthy" case asserting it does NOT cry wolf.
 */

const NOW = new Date("2026-07-20T12:00:00Z").getTime();
const FRESH = "2026-07-20T04:00:00Z"; // 8h old

/** A fully-healthy market row; tests override single fields to inject one fault. */
function healthy(region: string, over: Partial<MarketRow> = {}): MarketRow {
  return {
    region,
    medianPrice: 830_000,
    avgPrice: 1_030_946,
    yoyPct: 1.4,
    medianPpsf: 780,
    activeCount: 10_698,
    monthsOfSupply: 5.2,
    soldToListPct: 99.4,
    trueDom: 73,
    medianNaiveDom: 40,
    soldMedianDom: 21,
    soldP25Dom: 10,
    soldP75Dom: 43,
    sellThroughPct: 55,
    stalePct: 30,
    temperature: "balanced",
    priceSeries: [{ month: "2026-06", v: 830_000 }],
    cutShare: 0.145,
    cutCount: 1547,
    cutActive: 10_698,
    medianCutPct: 8.5,
    medianCutAmt: 85_000,
    domBuckets: { d0_14: 1581, d15_30: 1513, d31_60: 613, d61_90: 2459, d90plus: 4532 },
    rentalRows: [{ beds: 2, typicalRent: 2630, medianPrice: 720_000, grossYieldPct: 4.38 }],
    ...over,
  };
}

const errorsOf = (ps: Problem[]) => ps.filter((p) => p.severity === "error");
const has = (ps: Problem[], check: string) => ps.some((p) => p.check === check);

const base = {
  expectedMarkets: ["Toronto"],
  dataAsOf: FRESH,
  staleHours: 36,
  now: NOW,
  knownGaps: {},
};

describe("data-health canary — healthy baseline", () => {
  it("reports nothing for a fully-populated market", () => {
    const problems = checkMarketRows({ ...base, rows: [healthy("Toronto")] });
    expect(problems).toEqual([]);
  });
});

describe("regression: migration 082 was never applied", () => {
  // Signature: avgPrice null across EVERY market (the column the migration added), while
  // everything else looks plausible. Served silently for days.
  it("catches avgPrice null across all markets", () => {
    const problems = checkMarketRows({
      ...base,
      expectedMarkets: ["Toronto", "Mississauga"],
      rows: [healthy("Toronto", { avgPrice: null }), healthy("Mississauga", { avgPrice: null })],
    });
    const errs = errorsOf(problems);
    expect(errs.length).toBe(2);
    expect(errs.every((e) => e.check === "completeness" && e.detail.includes("avgPrice"))).toBe(true);
  });

  it("catches the stale precompute that a failed refresh leaves behind", () => {
    const problems = checkMarketRows({
      ...base,
      rows: [healthy("Toronto")],
      dataAsOf: "2026-07-17T04:00:00Z", // 80h old
    });
    expect(has(errorsOf(problems), "freshness")).toBe(true);
  });
});

describe("regression: Toronto price-cuts starved to null (RPC timeout under contention)", () => {
  it("catches a single market's metric going null", () => {
    const problems = checkMarketRows({
      ...base,
      rows: [healthy("Toronto", { cutShare: null, cutCount: null, cutActive: null })],
    });
    const errs = errorsOf(problems);
    expect(errs.some((e) => e.check === "completeness" && e.detail.includes("cutShare"))).toBe(true);
  });
});

describe("regression: Toronto rental yield returned zero rows", () => {
  it("catches an empty rentalRows array", () => {
    const problems = checkMarketRows({ ...base, rows: [healthy("Toronto", { rentalRows: [] })] });
    expect(errorsOf(problems).some((e) => e.detail.includes("no rental yield rows"))).toBe(true);
  });
});

describe("regression: Ottawa's fake 100% sell-through", () => {
  // failure_rate 0 (because 0 delisted rows matched) → sell-through rendered as a perfect
  // 100%, which looks like a triumphant market rather than a broken join.
  it("catches an exact 100% sell-through as out of range", () => {
    const problems = checkMarketRows({ ...base, rows: [healthy("Toronto", { sellThroughPct: 100 })] });
    expect(errorsOf(problems).some((e) => e.check === "range" && e.detail.includes("sell-through"))).toBe(true);
  });

  it("stays quiet for a genuine gap that is on the allowlist", () => {
    const problems = checkMarketRows({
      ...base,
      expectedMarkets: ["Ottawa"],
      rows: [healthy("Ottawa", { sellThroughPct: null, rentalRows: [] })],
      knownGaps: {
        "Ottawa:sellThroughPct": "structural: delisted feed has no CountyOrParish",
        "Ottawa:rentalRows": "structural: rents keyed by OREB area name",
      },
    });
    expect(errorsOf(problems)).toEqual([]);
  });

  it("reports a known gap that starts returning data, so the allowlist cannot rot", () => {
    const problems = checkMarketRows({
      ...base,
      expectedMarkets: ["Ottawa"],
      rows: [healthy("Ottawa")], // gap resolved — sell-through + rentals now populated
      knownGaps: {
        "Ottawa:sellThroughPct": "structural",
        "Ottawa:rentalRows": "structural",
      },
    });
    expect(problems.filter((p) => p.check === "gap-resolved").length).toBe(2);
    expect(errorsOf(problems)).toEqual([]);
  });

  it("flags an allowlist entry that no longer matches any market", () => {
    const problems = checkMarketRows({
      ...base,
      rows: [healthy("Toronto")],
      knownGaps: { "Ottowa:sellThroughPct": "typo'd market name" },
    });
    expect(has(problems, "stale-allowlist")).toBe(true);
  });
});

describe("regression: a market disappearing from the precompute", () => {
  it("catches missing coverage", () => {
    const problems = checkMarketRows({
      ...base,
      expectedMarkets: ["Toronto", "Ottawa"],
      rows: [healthy("Toronto")],
    });
    expect(errorsOf(problems).some((e) => e.check === "coverage" && e.detail.includes("Ottawa"))).toBe(true);
  });
});

describe("regression: ghost-inflated active counts / implausible values", () => {
  it("catches an out-of-range months of supply", () => {
    const problems = checkMarketRows({ ...base, rows: [healthy("Toronto", { monthsOfSupply: 44 })] });
    expect(errorsOf(problems).some((e) => e.check === "range")).toBe(true);
  });

  it("catches an impossible sold-to-list ratio", () => {
    const problems = checkMarketRows({ ...base, rows: [healthy("Toronto", { soldToListPct: 158 })] });
    expect(errorsOf(problems).some((e) => e.check === "range")).toBe(true);
  });
});

describe("regression: condo corp-key collapse + missing stale-row eviction", () => {
  const condo = (over: Partial<CondoAreaRow> = {}): CondoAreaRow => ({
    area: "Waterfront Communities C1",
    city: "Toronto",
    annualPct: 3.8,
    p25AnnualPct: 1.8,
    p75AnnualPct: 5.4,
    buildingCount: 61,
    sampleCount: 900,
    medianPsf: 0.92,
    band: "Moderate",
    ...over,
  });

  it("catches cohorts beyond the estimator clamp (the +568%/yr signature)", () => {
    const problems = checkCondoRows({
      rows: [condo()],
      dataAsOf: FRESH,
      staleDays: 10,
      now: NOW,
      clampViolations: [
        { cohort_type: "corp", cohort_key: "539", pct: 567.96 },
        { cohort_type: "corp", cohort_key: "529", pct: 441.17 },
      ],
    });
    expect(errorsOf(problems).some((e) => e.check === "condo-clamp")).toBe(true);
  });

  it("catches an empty condo tracker", () => {
    const problems = checkCondoRows({
      rows: [],
      dataAsOf: FRESH,
      staleDays: 10,
      now: NOW,
      clampViolations: [],
    });
    expect(errorsOf(problems).some((e) => e.check === "condo-coverage")).toBe(true);
  });

  it("catches a weekly refresh that stopped running", () => {
    const problems = checkCondoRows({
      rows: [condo()],
      dataAsOf: "2026-06-20T04:00:00Z", // 30d old
      staleDays: 10,
      now: NOW,
      clampViolations: [],
    });
    expect(errorsOf(problems).some((e) => e.check === "condo-freshness")).toBe(true);
  });

  it("stays quiet on healthy condo data", () => {
    const problems = checkCondoRows({
      rows: [condo()],
      dataAsOf: FRESH,
      staleDays: 10,
      now: NOW,
      clampViolations: [],
    });
    expect(problems).toEqual([]);
  });
});

describe("drift detection — the wrong-but-plausible class", () => {
  // Every value here sits comfortably inside the range checks, so ONLY drift can catch it.
  const snap = (over: Record<string, number | null> = {}, region = "Toronto"): SnapshotEntry[] => {
    const base: Record<string, number | null> = {
      medianPrice: 830_000,
      avgPrice: 1_030_946,
      activeCount: 10_698,
      monthsOfSupply: 5.2,
      soldToListPct: 99.4,
      trueDom: 73,
      soldMedianDom: 21,
      cutSharePct: 14.5,
      sellThroughPct: 55,
      [LATEST_MONTH_KEY]: 202606,
      ...over,
    };
    return Object.entries(base).map(([metric, value]) => ({ region, metric, value }));
  };

  it("stays quiet when nothing moved", () => {
    expect(checkDrift(snap(), snap())).toEqual([]);
  });

  it("stays quiet on the small night-to-night wobble a healthy recompute produces", () => {
    expect(checkDrift(snap(), snap({ medianPrice: 833_000, activeCount: 10_750, trueDom: 74 }))).toEqual([]);
  });

  it("errors when active inventory nearly halves overnight (a join/filter break)", () => {
    const p = checkDrift(snap(), snap({ activeCount: 5_800 }));
    const e = p.filter((x) => x.severity === "error");
    expect(e.length).toBe(1);
    expect(e[0].check).toBe("drift");
    expect(e[0].detail).toContain("active listings");
  });

  it("errors when a plausible-looking median price jumps 25%+ within the same month", () => {
    const p = checkDrift(snap(), snap({ medianPrice: 1_100_000 }));
    expect(p.some((x) => x.severity === "error" && x.detail.includes("median sold price"))).toBe(true);
  });

  it("warns (not errors) on a moderate move", () => {
    const p = checkDrift(snap(), snap({ trueDom: 90 })); // +23% → warn band
    expect(p.length).toBe(1);
    expect(p[0].severity).toBe("warn");
  });

  it("uses absolute points for ratio metrics like sold-to-list", () => {
    const p = checkDrift(snap(), snap({ soldToListPct: 105 })); // +5.6 pts → error
    expect(p.some((x) => x.severity === "error" && x.detail.includes("sold-to-list"))).toBe(true);
  });

  // The key false-positive guard: at the start of a new month the "latest month" has very
  // few sales, so its median legitimately swings. Without this the canary would cry wolf
  // every month-end and be ignored exactly when it matters.
  it("does NOT flag price swings when the month rolled over", () => {
    const p = checkDrift(snap(), snap({ medianPrice: 1_200_000, avgPrice: 1_500_000, [LATEST_MONTH_KEY]: 202607 }));
    expect(p).toEqual([]);
  });

  it("still flags month-INSENSITIVE metrics across a month rollover", () => {
    const p = checkDrift(snap(), snap({ activeCount: 5_800, [LATEST_MONTH_KEY]: 202607 }));
    expect(p.some((x) => x.detail.includes("active listings"))).toBe(true);
  });

  it("skips null transitions (already covered by the completeness check)", () => {
    expect(checkDrift(snap(), snap({ medianPrice: null }))).toEqual([]);
    expect(checkDrift(snap({ medianPrice: null }), snap())).toEqual([]);
  });

  it("returns nothing on the very first run (no prior snapshot)", () => {
    expect(checkDrift([], snap())).toEqual([]);
  });

  it("compares each region independently", () => {
    const prev = [...snap({}, "Toronto"), ...snap({}, "Ottawa")];
    const curr = [...snap({}, "Toronto"), ...snap({ activeCount: 2_000 }, "Ottawa")];
    const p = checkDrift(prev, curr);
    expect(p.length).toBe(1);
    expect(p[0].detail).toContain("Ottawa");
  });

  it("snapshotFromRows captures the month key and scales cut share to points", () => {
    const entries = snapshotFromRows([healthy("Toronto")]);
    const find = (m: string) => entries.find((e) => e.metric === m)?.value;
    expect(find(LATEST_MONTH_KEY)).toBe(202606);
    expect(find("cutSharePct")).toBeCloseTo(14.5, 1);
    expect(find("medianPrice")).toBe(830_000);
  });
});

describe("regression: silent email-send failure (the 2026-07 welcome-email incident)", () => {
  it("stays quiet when there are no recent failures", () => {
    expect(checkEmailFailures([])).toEqual([]);
  });

  it("errors on a missing_key failure with a Vercel-pointed hint", () => {
    const p = checkEmailFailures([{ kind: "welcome", reason: "missing_key" }]);
    expect(p.length).toBe(1);
    expect(p[0].severity).toBe("error");
    expect(p[0].check).toBe("email-delivery");
    expect(p[0].detail).toContain("missing_key");
    expect(p[0].detail).toContain("Vercel");
  });

  it("errors on a bad-key/API failure and points at the key value", () => {
    const p = checkEmailFailures([{ kind: "welcome", reason: "validation_error: API key is invalid" }]);
    expect(p[0].severity).toBe("error");
    expect(p[0].detail).toContain("Resend key value");
  });

  it("summarizes a mixed batch by kind", () => {
    const p = checkEmailFailures([
      { kind: "welcome", reason: "missing_key" },
      { kind: "welcome", reason: "missing_key" },
      { kind: "confirmation:listing-alerts", reason: "missing_key" },
    ]);
    expect(p[0].detail).toContain("welcome×2");
    expect(p[0].detail).toContain("confirmation:listing-alerts×1");
  });
});

describe("regression: an unapplied migration (the 082 root cause)", () => {
  it("catches a repo migration missing from the ledger", () => {
    const problems = checkMigrationLedger(
      ["081_a.sql", "082_b.sql", "083_c.sql"],
      ["081_a.sql", "083_c.sql"]
    );
    expect(errorsOf(problems).some((e) => e.detail.includes("082_b.sql"))).toBe(true);
  });

  it("warns (not errors) when the ledger has never been baselined", () => {
    const problems = checkMigrationLedger(["081_a.sql"], []);
    expect(errorsOf(problems)).toEqual([]);
    expect(has(problems, "migrations")).toBe(true);
  });

  it("stays quiet when every migration is recorded", () => {
    expect(checkMigrationLedger(["081_a.sql"], ["081_a.sql", "080_old.sql"])).toEqual([]);
  });
});

describe("regression: price-events capture never scheduled (zero rows ever, 2026-07-22)", () => {
  // The nightly capture step lived only in the abandoned Railway orchestrator, so
  // price_events stayed empty in prod for a week — nothing watched it. The heartbeat
  // is listing_price_state.updated_at (state moves every successful run).
  const NOW = Date.parse("2026-07-22T12:00:00Z");

  it("errors when the state table has never been seeded", () => {
    const problems = checkPriceLedger({ stateNewest: null, staleHours: 48, now: NOW });
    expect(errorsOf(problems).some((e) => e.check === "price-ledger" && e.detail.includes("never run"))).toBe(true);
  });

  it("errors when the capture stops landing (state older than the limit)", () => {
    const problems = checkPriceLedger({
      stateNewest: "2026-07-19T12:00:00Z", // 72h before NOW
      staleHours: 48,
      now: NOW,
    });
    expect(errorsOf(problems).some((e) => e.check === "price-ledger" && e.detail.includes("72.0h"))).toBe(true);
  });

  it("stays quiet when the nightly capture is landing", () => {
    expect(
      checkPriceLedger({ stateNewest: "2026-07-22T04:00:00Z", staleHours: 48, now: NOW })
    ).toEqual([]);
  });
});
