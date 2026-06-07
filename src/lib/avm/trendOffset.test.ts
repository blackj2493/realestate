/**
 * Shared AVM trend/offset aggregation core (src/lib/avm/trendOffset.ts).
 *
 * Locks the behaviour the nightly refresh job and the out-of-time backtest harness
 * BOTH depend on. The window-agnostic property is the leakage guard: the function
 * aggregates exactly the records it is handed and never reads a clock or DB, so the
 * backtest can hand it only `date < t_S` records to get a clean as-of snapshot.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateTrendAndOffset,
  adjustedLogPrice,
  median,
  periodEndForDate,
  selectTrendSeries,
  selectOffsets,
  type LRecord,
  type Matrix,
  type SoldFeatures,
  type TrendRow,
  type OffsetRow,
} from './trendOffset';

// ── helpers ──────────────────────────────────────────────────────────────────
function matrixOf(entries: Record<string, { beta: number; mean: number; std: number }>): Matrix {
  return new Map(Object.entries(entries));
}

function soldRow(overrides: Partial<SoldFeatures> = {}): SoldFeatures {
  return {
    close_price: 1_000_000,
    building_area_total: null,
    lot_width: null,
    bedrooms_above_grade: null,
    bathrooms_total_integer: null,
    parking_total: null,
    interior_tier: null,
    exterior_tier: null,
    basement_tier: null,
    ...overrides,
  };
}

function lrec(over: Partial<LRecord> & Pick<LRecord, 'cityRegion' | 'l'>): LRecord {
  return {
    city: 'Testville',
    subType: 'Detached',
    periodEnd: '2026-06-30',
    ...over,
  };
}

// ── median ───────────────────────────────────────────────────────────────────
describe('median', () => {
  it('odd-length returns the middle element', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('even-length averages the two middle elements', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('is order-independent and non-mutating', () => {
    const input = [5, 2, 9, 1];
    expect(median(input)).toBe(3.5);
    expect(input).toEqual([5, 2, 9, 1]); // not sorted in place
  });
});

// ── periodEndForDate ───────────────────────────────────────────────────────────
describe('periodEndForDate', () => {
  it('maps Jan–Jun to YYYY-06-30 and Jul–Dec to YYYY-12-31 (UTC)', () => {
    expect(periodEndForDate('2026-01-15')).toBe('2026-06-30');
    expect(periodEndForDate('2026-06-30')).toBe('2026-06-30');
    expect(periodEndForDate('2026-07-01')).toBe('2026-12-31');
    expect(periodEndForDate('2026-12-31')).toBe('2026-12-31');
  });
});

// ── adjustedLogPrice ───────────────────────────────────────────────────────────
describe('adjustedLogPrice', () => {
  it('returns null when there is no usable sold price', () => {
    expect(adjustedLogPrice(soldRow({ close_price: 0 }), matrixOf({}))).toBeNull();
    expect(adjustedLogPrice(soldRow({ close_price: null }), matrixOf({}))).toBeNull();
  });

  it('returns ln(price) when the matrix has no applicable coefficients', () => {
    const l = adjustedLogPrice(soldRow({ close_price: 1_000_000 }), matrixOf({}));
    expect(l).toBeCloseTo(Math.log(1_000_000), 10);
  });

  it('subtracts beta·z for a present feature', () => {
    // beds=5, mean=3, std=1 → z=2 → l = ln(price) − 0.1·2
    const m = matrixOf({ bedrooms_above_grade: { beta: 0.1, mean: 3, std: 1 } });
    const l = adjustedLogPrice(soldRow({ bedrooms_above_grade: 5 }), m);
    expect(l).toBeCloseTo(Math.log(1_000_000) - 0.2, 10);
  });

  it('clamps the z-score to ±3', () => {
    // beds=100 → z=97 → clamped to 3 → l = ln(price) − 0.1·3
    const m = matrixOf({ bedrooms_above_grade: { beta: 0.1, mean: 3, std: 1 } });
    const l = adjustedLogPrice(soldRow({ bedrooms_above_grade: 100 }), m);
    expect(l).toBeCloseTo(Math.log(1_000_000) - 0.3, 10);
  });

  it('converts condition tiers to scores (interior 6−tier)', () => {
    // interior_tier=1 → score=5, mean=3, std=1 → z=2 → l = ln(price) − 0.05·2
    const m = matrixOf({ interior_score: { beta: 0.05, mean: 3, std: 1 } });
    const l = adjustedLogPrice(soldRow({ interior_tier: 1 }), m);
    expect(l).toBeCloseTo(Math.log(1_000_000) - 0.1, 10);
  });

  it('skips features with std ≤ 0 or beta = 0, and skips null features', () => {
    const m = matrixOf({
      bedrooms_above_grade: { beta: 0.1, mean: 3, std: 0 }, // std 0 → skip
      bathrooms_total_integer: { beta: 0, mean: 2, std: 1 }, // beta 0 → skip
      lot_width: { beta: 0.2, mean: 30, std: 10 }, // present in matrix but row lot_width=null → skip
    });
    const l = adjustedLogPrice(soldRow({ bedrooms_above_grade: 5, bathrooms_total_integer: 4 }), m);
    expect(l).toBeCloseTo(Math.log(1_000_000), 10); // nothing applied
  });

  it('treats lot_width ≤ 0 as absent', () => {
    const m = matrixOf({ lot_width: { beta: 0.2, mean: 30, std: 10 } });
    const l = adjustedLogPrice(soldRow({ lot_width: 0 }), m);
    expect(l).toBeCloseTo(Math.log(1_000_000), 10);
  });
});

// ── aggregateTrendAndOffset ─────────────────────────────────────────────────────
describe('aggregateTrendAndOffset', () => {
  // Qualified bucket (2026-06-30): 8 records, ℓ = 1..8 → median 4.5.
  //   Region A: ℓ = 3,4,5,6,7 (5 recs) → δ = −1.5..2.5, median 0.5  → qualifies (≥5)
  //   Region B: ℓ = 1,2,8     (3 recs) → only 3 δ                   → dropped (<5)
  // Unqualified bucket (2025-12-31): 3 records → below minTrend(8) → dropped, and
  //   its records contribute NO offset (g undefined).
  const records: LRecord[] = [
    ...[3, 4, 5, 6, 7].map((l) => lrec({ cityRegion: 'Region A', l })),
    ...[1, 2, 8].map((l) => lrec({ cityRegion: 'Region B', l })),
    ...[10, 11, 12].map((l) => lrec({ cityRegion: 'Region A', periodEnd: '2025-12-31', l })),
  ];

  it('publishes only trend buckets at/above minTrendSamples; level_log = median', () => {
    const { trendRows } = aggregateTrendAndOffset(records);
    expect(trendRows).toHaveLength(1);
    expect(trendRows[0]).toMatchObject({
      city: 'Testville',
      property_sub_type: 'Detached',
      period_end: '2026-06-30',
      level_log: 4.5,
      n_sales: 8,
    });
  });

  it('publishes offsets only at/above minOffsetSamples; δ measured vs the qualified trend g', () => {
    const { offsetRows } = aggregateTrendAndOffset(records);
    expect(offsetRows).toHaveLength(1);
    expect(offsetRows[0]).toMatchObject({
      city_region: 'Region A',
      property_sub_type: 'Detached',
      delta_log: 0.5, // median(−1.5,−0.5,0.5,1.5,2.5)
      n_sales: 5,
    });
  });

  it('drops records whose trend bucket fell below the gate from the offset sample', () => {
    // Region A appears in both periods, but the 2025-12-31 records have no qualified
    // g, so only the 5 same-period records form Region A's offset (n_sales = 5, not 8).
    const { offsetRows } = aggregateTrendAndOffset(records);
    expect(offsetRows[0].n_sales).toBe(5);
  });

  it('reports pre-gate bucket counts in stats', () => {
    const { stats } = aggregateTrendAndOffset(records);
    expect(stats.trendBuckets).toBe(2); // 2026-06-30 and 2025-12-31
    expect(stats.offsetBuckets).toBe(2); // Region A and Region B (both from the qualified period)
  });

  it('honours custom thresholds', () => {
    const { trendRows, offsetRows } = aggregateTrendAndOffset(records, {
      minTrendSamples: 3,
      minOffsetSamples: 3,
    });
    // Now both periods qualify as trend buckets…
    expect(trendRows.map((t) => t.period_end).sort()).toEqual(['2025-12-31', '2026-06-30']);
    // …and Region B (3 δ in the H1 bucket) now also qualifies for an offset.
    expect(offsetRows.map((o) => o.city_region).sort()).toEqual(['Region A', 'Region B']);
  });

  it('is window-agnostic: output reflects exactly the records passed (the leakage guard)', () => {
    // Caller emulates an as-of cutoff by filtering records itself. The function adds
    // nothing from outside that slice — proving no future data can leak in.
    const asOf = records.filter((r) => r.periodEnd <= '2026-06-30');
    const full = aggregateTrendAndOffset(records);
    const sliced = aggregateTrendAndOffset(asOf);
    expect(sliced.trendRows).toEqual(full.trendRows); // 2025-12-31 was already sub-gate in both
    expect(sliced.offsetRows).toEqual(full.offsetRows);
    // And a strictly-earlier cutoff yields nothing once the H1 bucket is excluded.
    const earlier = aggregateTrendAndOffset(records.filter((r) => r.periodEnd < '2026-06-30'));
    expect(earlier.trendRows).toHaveLength(0);
    expect(earlier.offsetRows).toHaveLength(0);
  });

  it('returns empty results for empty input', () => {
    const { trendRows, offsetRows, stats } = aggregateTrendAndOffset([]);
    expect(trendRows).toHaveLength(0);
    expect(offsetRows).toHaveLength(0);
    expect(stats).toEqual({ trendBuckets: 0, offsetBuckets: 0 });
  });
});

// ── selectTrendSeries / selectOffsets (as-of shaping for the backtest) ──────────
const TREND_FIX: TrendRow[] = [
  { city: 'Brampton', property_sub_type: 'Detached', period_end: '2025-06-30', level_log: 13.1, n_sales: 40 },
  { city: 'Brampton', property_sub_type: 'Detached', period_end: '2025-12-31', level_log: 13.2, n_sales: 50 },
  { city: 'Brampton', property_sub_type: 'Detached', period_end: '2024-12-31', level_log: 13.0, n_sales: 30 },
  { city: 'Brampton', property_sub_type: 'Condo Apartment', period_end: '2025-12-31', level_log: 12.5, n_sales: 20 },
  { city: 'Mississauga', property_sub_type: 'Detached', period_end: '2025-12-31', level_log: 13.4, n_sales: 25 },
];

describe('selectTrendSeries', () => {
  it('filters to city × sub-type and orders most-recent period first', () => {
    const s = selectTrendSeries(TREND_FIX, 'Brampton', 'Detached');
    expect(s).toEqual([
      { period_end: '2025-12-31', level_log: 13.2 },
      { period_end: '2025-06-30', level_log: 13.1 },
      { period_end: '2024-12-31', level_log: 13.0 },
    ]);
    // trend[0] is gNow — the most recent period at/under the as-of cutoff.
    expect(s[0].period_end).toBe('2025-12-31');
  });

  it('matches city + sub-type case-insensitively (mirrors live .ilike)', () => {
    expect(selectTrendSeries(TREND_FIX, 'BRAMPTON', 'detached')).toHaveLength(3);
  });

  it('caps to the limit', () => {
    const s = selectTrendSeries(TREND_FIX, 'Brampton', 'Detached', 2);
    expect(s.map((t) => t.period_end)).toEqual(['2025-12-31', '2025-06-30']);
  });

  it('returns empty when the cohort is absent', () => {
    expect(selectTrendSeries(TREND_FIX, 'Toronto', 'Detached')).toEqual([]);
  });
});

const OFFSET_FIX: OffsetRow[] = [
  { city_region: '1001 - BR Bronte', property_sub_type: 'Detached', delta_log: 0.3, n_sales: 10 },
  { city_region: 'Brampton East', property_sub_type: 'Detached', delta_log: -0.1, n_sales: 12 },
  { city_region: 'Brampton East', property_sub_type: 'Condo Apartment', delta_log: -0.2, n_sales: 8 },
  { city_region: 'Other Region', property_sub_type: 'Detached', delta_log: 0.5, n_sales: 9 },
];

describe('selectOffsets', () => {
  it('matches city_region exactly against candidates and sub-type case-insensitively', () => {
    const o = selectOffsets(OFFSET_FIX, ['Brampton East', 'Bronte'], 'Detached');
    expect(o).toEqual([{ city_region: 'Brampton East', delta_log: -0.1 }]);
  });

  it('matches a prefixed candidate spelling exactly when passed', () => {
    const o = selectOffsets(OFFSET_FIX, ['1001 - BR Bronte'], 'detached');
    expect(o).toEqual([{ city_region: '1001 - BR Bronte', delta_log: 0.3 }]);
  });

  it('excludes non-candidate regions and mismatched sub-types', () => {
    const o = selectOffsets(OFFSET_FIX, ['Brampton East'], 'Condo Apartment');
    expect(o).toEqual([{ city_region: 'Brampton East', delta_log: -0.2 }]);
    expect(selectOffsets(OFFSET_FIX, ['Other Region'], 'Condo Apartment')).toEqual([]);
  });
});
