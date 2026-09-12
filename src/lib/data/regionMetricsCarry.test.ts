import { describe, it, expect } from "vitest";
import { carryForwardSlices, CARRY_MAX_HOURS_DEFAULT, type Payload } from "@/lib/data/regionMetricsCarry";

/**
 * Regression suite for the region_metrics carry-forward.
 *
 * The first case REPLAYS the Ottawa row of 2026-09-12: four slices cancelled at the 30s
 * supabase-js abort, written as nulls over a perfectly good previous snapshot, and served as
 * "—" on /data for the next 24 hours. The rest pin down the property that makes the fix safe
 * to keep — the carry EXPIRES, so a slice that is genuinely broken still reaches the canary
 * instead of hiding behind yesterday's number forever.
 */

const NOW = Date.parse("2026-09-12T05:07:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

/** Yesterday's Ottawa row, all 11 slices present. */
const priorOttawa = (): Payload => ({
  trend: { points: [] },
  stats: { stats: { activeCount: 4159 } },
  dom: { dom: { medianTrueDom: 57 } },
  cuts: { cuts: { cutShare: 0.21 } },
  dynamics: { dynamics: { medianDom: 31 } },
  rental: { rental: { rows: [{ beds: 1 }, { beds: 2 }] } },
  avm: {},
  inventory: {},
  seasonality: {},
  outcomes: {},
  ledger: {},
});

describe("carryForwardSlices", () => {
  it("replays Ottawa 2026-09-12: four slices cancelled at 30s keep yesterday's values", () => {
    const fresh: Payload = {
      ...priorOttawa(),
      stats: null,
      dom: null,
      cuts: null,
      rental: null,
    };

    const carried = carryForwardSlices({
      fresh,
      prior: priorOttawa(),
      priorComputedAt: hoursAgo(24),
      nullSlices: ["stats", "dom", "cuts", "rental"],
      nowMs: NOW,
    });

    expect(carried).toEqual(["stats", "dom", "cuts", "rental"]);
    expect(fresh.stats).toEqual({ stats: { activeCount: 4159 } });
    expect(fresh.rental).toEqual({ rental: { rows: [{ beds: 1 }, { beds: 2 }] } });
    // Slices that computed fine tonight are untouched.
    expect(fresh.trend).toEqual({ points: [] });
  });

  it("gives up once the prior snapshot is older than the window, so the canary fires", () => {
    const fresh: Payload = { ...priorOttawa(), rental: null };

    const carried = carryForwardSlices({
      fresh,
      prior: priorOttawa(),
      priorComputedAt: hoursAgo(CARRY_MAX_HOURS_DEFAULT + 1),
      nullSlices: ["rental"],
      nowMs: NOW,
    });

    expect(carried).toEqual([]);
    expect(fresh.rental).toBeNull();
  });

  it("carries nothing when every slice computed — the healthy night", () => {
    const fresh = priorOttawa();
    const carried = carryForwardSlices({
      fresh,
      prior: priorOttawa(),
      priorComputedAt: hoursAgo(24),
      nullSlices: [],
      nowMs: NOW,
    });
    expect(carried).toEqual([]);
  });

  it("carries nothing when there is no prior row, or it could not be read", () => {
    const fresh: Payload = { rental: null };
    expect(
      carryForwardSlices({ fresh, prior: null, priorComputedAt: hoursAgo(1), nullSlices: ["rental"], nowMs: NOW })
    ).toEqual([]);
    expect(
      carryForwardSlices({ fresh, prior: priorOttawa(), priorComputedAt: null, nullSlices: ["rental"], nowMs: NOW })
    ).toEqual([]);
    expect(fresh.rental).toBeNull();
  });

  it("does not carry a slice the prior row was also missing", () => {
    const prior: Payload = { ...priorOttawa(), rental: null };
    const fresh: Payload = { ...priorOttawa(), rental: null, cuts: null };

    const carried = carryForwardSlices({
      fresh,
      prior,
      priorComputedAt: hoursAgo(24),
      nullSlices: ["rental", "cuts"],
      nowMs: NOW,
    });

    expect(carried).toEqual(["cuts"]);
    expect(fresh.rental).toBeNull();
  });

  it("refuses a prior stamp in the future — a clock fault is not freshness", () => {
    const fresh: Payload = { ...priorOttawa(), rental: null };
    const carried = carryForwardSlices({
      fresh,
      prior: priorOttawa(),
      priorComputedAt: hoursAgo(-2),
      nullSlices: ["rental"],
      nowMs: NOW,
    });
    expect(carried).toEqual([]);
  });

  it("refuses an unparseable prior stamp rather than treating it as fresh", () => {
    const fresh: Payload = { ...priorOttawa(), rental: null };
    const carried = carryForwardSlices({
      fresh,
      prior: priorOttawa(),
      priorComputedAt: "not a date",
      nullSlices: ["rental"],
      nowMs: NOW,
    });
    expect(carried).toEqual([]);
  });
});
