/**
 * AVM trend/offset aggregation — the deterministic core shared by the nightly
 * refresh job (scripts/admin/refresh-avm-trend-offset.ts) and the out-of-time
 * backtest harness (scripts/admin/avm-backtest.ts, plan how-do-we-moonlit-tarjan
 * Phase 1).
 *
 * Splits price into a CITY trend g(city, sub, half-year) + a persistent COMMUNITY
 * offset δ(city_region, sub), both computed from FEATURE-ADJUSTED ln(close_price)
 * so the feature premium and the trend cancel out of the level (migration 024):
 *
 *   ℓ_i = ln(close_price_i) − Σ β_f · clamp((x_{i,f} − μ_f) / σ_f, ±Z)
 *   g(city, sub, period) = robust median of ℓ_i over (city × sub × period)
 *   δ(c, sub)            = median over c's comps of (ℓ_i − g(city, sub, period_i))
 *
 * WINDOW-AGNOSTIC BY DESIGN. This module never reads the clock or a database — it
 * aggregates exactly the records it is handed. That is what makes it reusable for
 * the backtest: pass only sales with date < t_S and you get the trend/offset
 * SNAPSHOT as production would have computed it at t_S, with zero look-ahead
 * leakage. The nightly job passes its trailing 24-month window and gets today's
 * tables. Same code → the two can't drift.
 *
 * 100% deterministic, no AI (CLAUDE.md §4). Score conventions (6−interiorTier,
 * 5−exteriorTier, 10−basementTier) and the ±3 z-clamp match calculator.ts /
 * anchorService.ts so the standardization aligns with the live request path.
 */

import { compSqft } from './features';

/** Standardized per-feature coefficient (avm_multiplier_matrix row). */
export interface FeatureCoeff {
  beta: number;
  mean: number;
  std: number;
}

/** feature_name → coefficient, for one (city_region × sub-type) cohort. */
export type Matrix = Map<string, FeatureCoeff>;

/** Scalar feature columns of a raw_vow_sold row needed to feature-adjust price.
 *  A wider DB row (the refresh job's SoldRow) is structurally assignable to this. */
export interface SoldFeatures {
  close_price: number | null;
  building_area_total: number | null;
  /** Fallback half of compSqft. Optional so a caller that predates the coalesce still
   *  typechecks — it just keeps the old, sparser coverage. */
  living_area_range?: number | null;
  lot_width: number | null;
  bedrooms_above_grade: number | null;
  /** Den / below-grade bedrooms. Kept in step with anchorService: once the champion
   *  matrix carries a bedrooms_below_grade beta, a neutralizer that skips it disagrees
   *  with the one that does not. */
  bedrooms_below_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  interior_tier: number | null;
  exterior_tier: number | null;
  basement_tier: number | null;
}

/** A feature-adjusted log-level record, ready for trend/offset aggregation. */
export interface LRecord {
  city: string;
  cityRegion: string;
  subType: string;
  /** Half-year bucket end: 'YYYY-06-30' or 'YYYY-12-31'. */
  periodEnd: string;
  /** Feature-adjusted ln(close_price). */
  l: number;
}

/** Output row for avm_trend_index. */
export interface TrendRow {
  city: string;
  property_sub_type: string;
  period_end: string;
  level_log: number;
  n_sales: number;
}

/** Output row for avm_community_offset. */
export interface OffsetRow {
  city_region: string;
  property_sub_type: string;
  delta_log: number;
  n_sales: number;
}

/** ≥ this many ℓ_i to publish a city × sub × half-year trend bucket. */
export const DEFAULT_MIN_TREND_SAMPLES = 8;
/** ≥ this many δ_i to publish a (city_region × sub) community offset. */
export const DEFAULT_MIN_OFFSET_SAMPLES = 5;

/** z-clamp — matches calculator.ts/anchorService.ts so adjustments behave identically. */
export const TREND_Z_CLAMP = 3;

export interface AggregateOptions {
  minTrendSamples?: number;
  minOffsetSamples?: number;
}

/** Diagnostic counts (pre-gating) — distinct buckets observed during aggregation. */
export interface AggregateStats {
  /** Distinct (city × sub × period) buckets seen, before the min-sample gate. */
  trendBuckets: number;
  /** Distinct (city_region × sub) buckets that had ≥1 anchorable δ, before the gate. */
  offsetBuckets: number;
}

export interface AggregateResult {
  trendRows: TrendRow[];
  offsetRows: OffsetRow[];
  stats: AggregateStats;
}

/** Robust median of a numeric array (does not mutate the input). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** End-of-half-year date for a YYYY-MM-DD, ISO 'YYYY-06-30' or 'YYYY-12-31' (UTC). */
export function periodEndForDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  return m <= 5 ? `${y}-06-30` : `${y}-12-31`;
}

function clampZ(z: number): number {
  return Math.max(-TREND_Z_CLAMP, Math.min(TREND_Z_CLAMP, z));
}

/**
 * Feature-adjust ln(price): ℓ = ln(price) − Σ β·clamp(z(x)). Returns null when the
 * row has no usable sold price or the result is non-finite. Null features skip
 * (≡ training mean-imputation → z=0); tiers → scores; std>0 required.
 */
export function adjustedLogPrice(row: SoldFeatures, matrix: Matrix): number | null {
  if (!row.close_price || row.close_price <= 0) return null;
  let l = Math.log(row.close_price);

  const interiorScore = row.interior_tier !== null ? 6 - row.interior_tier : null;
  const exteriorScore = row.exterior_tier !== null ? 5 - row.exterior_tier : null;
  const basementScore = row.basement_tier !== null ? 10 - row.basement_tier : null;

  const feats: Array<[string, number | null]> = [
    ['building_area_total', compSqft(row)],
    ['lot_width', row.lot_width !== null && row.lot_width > 0 ? row.lot_width : null],
    ['bedrooms_above_grade', row.bedrooms_above_grade],
    ['bedrooms_below_grade', row.bedrooms_below_grade],
    ['bathrooms_total_integer', row.bathrooms_total_integer],
    ['parking_total', row.parking_total],
    ['basement_score', basementScore],
    ['interior_score', interiorScore],
    ['exterior_score', exteriorScore],
  ];

  for (const [name, value] of feats) {
    if (value === null) continue;
    const c = matrix.get(name);
    if (!c || c.beta === 0 || !(c.std > 0)) continue;
    const z = clampZ((value - c.mean) / c.std);
    l -= c.beta * z;
  }

  if (!Number.isFinite(l)) return null;
  return l;
}

/**
 * Aggregate feature-adjusted log-levels into trend + offset rows.
 *
 *   trend:  median(ℓ_i) per (city, sub, period), gated at ≥ minTrendSamples.
 *   offset: median(ℓ_i − g) per (city_region, sub), gated at ≥ minOffsetSamples,
 *           where g is the QUALIFIED trend level for that record's bucket. Records
 *           whose trend bucket fell below minTrendSamples (so g is unknown) are
 *           dropped from the offset sample — they have no anchor to offset against.
 *
 * Pure: identical `records` → identical rows (median is order-independent).
 */
export function aggregateTrendAndOffset(
  records: LRecord[],
  opts: AggregateOptions = {}
): AggregateResult {
  const minTrend = opts.minTrendSamples ?? DEFAULT_MIN_TREND_SAMPLES;
  const minOffset = opts.minOffsetSamples ?? DEFAULT_MIN_OFFSET_SAMPLES;

  // 1) Trend: (city, sub, period) → median(ℓ).
  const trendBuckets = new Map<string, number[]>(); // city||sub||period → ℓ values
  for (const rec of records) {
    const k = `${rec.city}||${rec.subType}||${rec.periodEnd}`;
    let b = trendBuckets.get(k);
    if (!b) {
      b = [];
      trendBuckets.set(k, b);
    }
    b.push(rec.l);
  }

  const trendRows: TrendRow[] = [];
  const gIndex = new Map<string, number>(); // city||sub||period → level_log (qualified only)
  for (const [k, values] of trendBuckets.entries()) {
    if (values.length < minTrend) continue;
    const [city, subType, periodEnd] = k.split('||');
    const levelLog = median(values);
    trendRows.push({
      city,
      property_sub_type: subType,
      period_end: periodEnd,
      level_log: levelLog,
      n_sales: values.length,
    });
    gIndex.set(k, levelLog);
  }

  // 2) Offset: δ_i = ℓ_i − g(city,sub,period); median per (city_region, sub).
  const offsetBuckets = new Map<string, number[]>(); // city_region||sub → δ values
  for (const rec of records) {
    // A sale with no community key belongs to the CITY trend but to NO community offset:
    // δ is defined per city_region, and there is nothing to key it on. Waterloo Region and
    // Brantford ship a blank CityRegion on every row, so without this guard all ~11k of
    // their sales would pool into one meaningless ''-keyed offset and then be written to
    // avm_community_offset as a real row.
    if (!rec.cityRegion) continue;
    const g = gIndex.get(`${rec.city}||${rec.subType}||${rec.periodEnd}`);
    if (g === undefined) continue; // bucket below minTrend → no anchor
    const key = `${rec.cityRegion}||${rec.subType}`;
    let b = offsetBuckets.get(key);
    if (!b) {
      b = [];
      offsetBuckets.set(key, b);
    }
    b.push(rec.l - g);
  }

  const offsetRows: OffsetRow[] = [];
  for (const [k, values] of offsetBuckets.entries()) {
    if (values.length < minOffset) continue;
    const [cityRegion, subType] = k.split('||');
    offsetRows.push({
      city_region: cityRegion,
      property_sub_type: subType,
      delta_log: median(values),
      n_sales: values.length,
    });
  }

  return {
    trendRows,
    offsetRows,
    stats: { trendBuckets: trendBuckets.size, offsetBuckets: offsetBuckets.size },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// As-of selection — shape aggregated rows into the arrays the anchor math wants,
// mirroring the live avm_trend_index / avm_community_offset queries. Used by the
// backtest to feed computeAnchorFromData a leakage-free as-of snapshot.
// ─────────────────────────────────────────────────────────────────────────────

/** Anchor-shaped trend point (structurally matches anchorService.TrendRow). */
export interface TrendPoint {
  period_end: string;
  level_log: number;
}

/** Anchor-shaped community offset (structurally matches anchorService.OffsetRow). */
export interface OffsetPoint {
  city_region: string;
  delta_log: number;
}

/**
 * Trend series for a subject's city × sub-type, ordered most-recent period first
 * and capped — mirrors `avm_trend_index … .ilike(city).ilike(sub).order(period_end
 * desc).limit(limit)`. Case-insensitive on city + sub-type (like the live `.ilike`).
 * The records fed to aggregateTrendAndOffset already enforce the as-of cutoff, so
 * trend[0] here is the most-recent period at-or-before that cutoff (= gNow).
 */
export function selectTrendSeries(
  trendRows: TrendRow[],
  city: string,
  propertySubType: string,
  limit = 8
): TrendPoint[] {
  const c = city.trim().toLowerCase();
  const s = propertySubType.trim().toLowerCase();
  return trendRows
    .filter(
      (t) => t.city.trim().toLowerCase() === c && t.property_sub_type.trim().toLowerCase() === s
    )
    .sort((a, b) => (a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : 0))
    .slice(0, limit)
    .map((t) => ({ period_end: t.period_end, level_log: t.level_log }));
}

/**
 * Community offsets for a subject's city_region candidates × sub-type — mirrors
 * `avm_community_offset … .in('city_region', candidates).ilike(sub)`. city_region
 * is matched exactly (candidates are the verbatim/prefix-stripped spellings);
 * sub-type case-insensitively. computeAnchorFromData's pickByCandidatePriority then
 * chooses the highest-priority candidate among the returned rows.
 */
export function selectOffsets(
  offsetRows: OffsetRow[],
  cityRegionCandidates: string[],
  propertySubType: string
): OffsetPoint[] {
  const s = propertySubType.trim().toLowerCase();
  const cand = new Set(cityRegionCandidates);
  return offsetRows
    .filter((o) => cand.has(o.city_region) && o.property_sub_type.trim().toLowerCase() === s)
    .map((o) => ({ city_region: o.city_region, delta_log: o.delta_log }));
}
