/**
 * AVM Anchor Service — de-staled, recency-weighted, shrunk local level.
 *
 * The 7-step pipeline (see plan concurrent-prancing-owl §"Anchor pipeline"):
 *   1. Pull local comps from raw_vow_sold (scalar columns only; respects Disk
 *      IO budget — see memory supabase-io-budget).
 *   2. Per-comp adjust to community-average log-level using the matrix
 *      β/μ/σ: ℓ_i = ln(close_price) − Σ β·z(x).
 *   3. De-stale each ℓ_i to "now" using the city × sub × half-year trend
 *      index: ℓ_i' = ℓ_i + (g(t₀) − g(t_i)).
 *   4. Robust (Huber) recency-weighted local estimate ℓ̂_local with
 *      Kish-effective sample size.
 *   5. Prior level ℓ_prior = g(t₀) + δ_c (precomputed offset; falls back to
 *      g(t₀) as city-average, then ln(Base_Price)).
 *   6. Bayesian shrinkage: ℓ̂ = (V⁻¹ℓ_local + τ⁻²ℓ_prior) / (V⁻¹ + τ⁻²).
 *   7. Return level + predictive SD + n_eff + comps + basis.
 *
 * 100% deterministic, no AI (CLAUDE.md §4). Reads raw_vow_sold READ-ONLY (§12).
 * raw_vow_sold pull uses `purchase_contract_date` (deal signing) not close_date
 * (legal transfer, lags 30–90d) to match the trend index's period bucketing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AVMInput, AnchorBasis } from './types';
import {
  COMP_WINDOW_MO,
  H_DAYS,
  TAU2,
  SIGMA2,
  HUBER_K,
  Z_CLAMP,
} from './types';
import type { CoefficientRow } from './matrixService';
import { rawVariantsOf, cityRegionLookupCandidates } from './normalizeType';

export interface AnchorResult {
  /** ln(price) at the community-average feature level. exp(anchorLevel) is the anchor. */
  anchorLevel: number;
  /** Predictive standard deviation in log-space (≈ relative half-width). */
  predSD: number;
  /** Kish-effective sample size after recency + Huber weights. */
  nEff: number;
  /** Raw comp count consulted (pre-weighting). */
  comps: number;
  /** Which leg of the pipeline produced the level. */
  basis: AnchorBasis;
}

interface CompRow {
  close_price: number;
  purchase_contract_date: string | null;
  close_date: string | null;
  building_area_total: number | null;
  lot_width: number | null;
  bedrooms_above_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  interior_tier: number | null;
  exterior_tier: number | null;
  basement_tier: number | null;
}

interface TrendRow {
  period_end: string;
  level_log: number;
}

interface OffsetRow {
  city_region: string;
  delta_log: number;
}

const UNAVAILABLE: AnchorResult = {
  anchorLevel: 0,
  predSD: Infinity,
  nEff: 0,
  comps: 0,
  basis: 'none',
};

// Cap on comps fetched per market — typical community pulls 50–300 in 12 mo;
// hot communities cap at this. Keeps memory bounded and the response < ~1 KB.
const MAX_COMPS = 500;

export async function fetchAnchor(
  supabase: SupabaseClient,
  input: AVMInput,
  coefficients: CoefficientRow[],
  basePriceFallback: number | null
): Promise<AnchorResult> {
  const cityRegionCandidates = cityRegionLookupCandidates(input.cityRegion);
  if (cityRegionCandidates.length === 0) return UNAVAILABLE;
  const subVariants = rawVariantsOf(input.propertySubType, input.rawPropertySubType);
  if (subVariants.length === 0) return UNAVAILABLE;

  // City drives the trend lookup; null City falls back to cityRegion (usually
  // misses avm_trend_index, prior chain then handles it).
  const cityKey = (input.city ?? input.cityRegion).trim();
  const subKey = input.propertySubType.toLowerCase().trim();

  const windowStart = new Date();
  windowStart.setUTCMonth(windowStart.getUTCMonth() - COMP_WINDOW_MO);
  const windowStartIso = windowStart.toISOString().slice(0, 10);

  // 3 indexed queries in parallel: comps + trend series + community offset.
  const [compsRes, trendRes, offsetRes] = await Promise.all([
    supabase
      .from('raw_vow_sold')
      .select(
        'close_price, purchase_contract_date, close_date, building_area_total, ' +
          'lot_width, bedrooms_above_grade, bathrooms_total_integer, parking_total, ' +
          'interior_tier, exterior_tier, basement_tier'
      )
      .in('city_region', cityRegionCandidates)
      .in('property_sub_type', subVariants)
      .gt('close_price', 0)
      .gte('purchase_contract_date', windowStartIso)
      .order('purchase_contract_date', { ascending: false })
      .limit(MAX_COMPS),

    supabase
      .from('avm_trend_index')
      .select('period_end, level_log')
      .ilike('city', cityKey)
      .ilike('property_sub_type', subKey)
      .order('period_end', { ascending: false })
      .limit(8),

    supabase
      .from('avm_community_offset')
      .select('city_region, delta_log')
      .in('city_region', cityRegionCandidates)
      .ilike('property_sub_type', subKey)
      .limit(cityRegionCandidates.length),
  ]);

  const comps = ((compsRes.data as unknown as CompRow[] | null) ?? []).filter(
    (c) => c.close_price > 0 && (c.purchase_contract_date || c.close_date)
  );
  const trend = (trendRes.data as unknown as TrendRow[] | null) ?? [];
  const offsets = (offsetRes.data as unknown as OffsetRow[] | null) ?? [];

  // ── Prior level: ℓ_prior = g(t₀) + δ_c (best available) ──────────────────
  const gNow = trend[0]?.level_log ?? null;
  const bestOffset = pickByCandidatePriority(offsets, cityRegionCandidates, (o) => o.city_region);

  let priorLevel: number | null = null;
  let priorBasisSeed: AnchorBasis = 'none';

  if (gNow !== null && bestOffset) {
    priorLevel = gNow + bestOffset.delta_log;
    priorBasisSeed = 'prior';
  } else if (gNow !== null) {
    // Treat the community as city-average (δ_c = 0). One-class-down basis.
    priorLevel = gNow;
    priorBasisSeed = 'parent';
  } else if (basePriceFallback !== null && basePriceFallback > 0) {
    // Last-resort prior: untracked Base_Price (no trend de-stale). Stale in
    // a moving market but better than no prior at all.
    priorLevel = Math.log(basePriceFallback);
    priorBasisSeed = 'parent';
  }

  // ── No local comps → prior alone (or unavailable) ────────────────────────
  if (comps.length === 0) {
    if (priorLevel === null) return UNAVAILABLE;
    return {
      anchorLevel: priorLevel,
      predSD: Math.sqrt(TAU2),
      nEff: 0,
      comps: 0,
      basis: priorBasisSeed,
    };
  }

  // ── Per-comp ℓ_i, de-staled to now ───────────────────────────────────────
  const coeff = new Map(coefficients.map((c) => [c.featureName, c]));
  const nowMs = Date.now();

  type Adjusted = { l: number; ageDays: number };
  const adjusted: Adjusted[] = [];
  for (const c of comps) {
    const dateIso = c.purchase_contract_date || c.close_date!;
    const lRaw = adjustedLogPrice(c, coeff);
    const gPrime = gNow !== null ? gNow - gAt(dateIso, trend) : 0;
    const l = lRaw + gPrime;
    if (!Number.isFinite(l)) continue;
    const ageDays = Math.max(0, (nowMs - new Date(dateIso).getTime()) / (1000 * 86400));
    adjusted.push({ l, ageDays });
  }

  if (adjusted.length === 0) {
    if (priorLevel === null) return UNAVAILABLE;
    return {
      anchorLevel: priorLevel,
      predSD: Math.sqrt(TAU2),
      nEff: 0,
      comps: 0,
      basis: priorBasisSeed,
    };
  }

  // ── Robust, recency-weighted local estimate ──────────────────────────────
  const recencyW = adjusted.map((a) => Math.exp(-a.ageDays / H_DAYS));
  const lValues = adjusted.map((a) => a.l);
  const wmed = weightedMedian(lValues, recencyW);
  const residuals = lValues.map((l) => l - wmed);
  const mad = median(residuals.map(Math.abs));
  // MAD → robust sigma. Guard against degenerate zero-spread cohorts so the
  // Huber denominator never goes to 0.
  const scale = (mad > 0 ? mad : 1e-6) * 1.4826;

  const huberW = residuals.map((r) => {
    const z = Math.abs(r) / scale;
    return z <= HUBER_K ? 1 : HUBER_K / z;
  });
  const w = recencyW.map((r, i) => r * huberW[i]);
  const sumW = w.reduce((a, b) => a + b, 0);

  if (sumW <= 0) {
    if (priorLevel === null) return UNAVAILABLE;
    return {
      anchorLevel: priorLevel,
      predSD: Math.sqrt(TAU2),
      nEff: 0,
      comps: 0,
      basis: priorBasisSeed,
    };
  }

  const lLocal = lValues.reduce((acc, l, i) => acc + l * w[i], 0) / sumW;
  // Kish-effective sample size after weighting.
  const sumW2 = w.reduce((acc, x) => acc + x * x, 0);
  const nEff = (sumW * sumW) / sumW2;
  // Local sampling variance ≈ residual variance / n_eff.
  const V = SIGMA2 / nEff;

  // ── Bayesian shrinkage toward prior ──────────────────────────────────────
  if (priorLevel !== null) {
    const wLocal = 1 / V;
    const wPrior = 1 / TAU2;
    const anchorLevel = (wLocal * lLocal + wPrior * priorLevel) / (wLocal + wPrior);
    const predSD = Math.sqrt(1 / (wLocal + wPrior));
    const fracLocal = wLocal / (wLocal + wPrior);
    return {
      anchorLevel,
      predSD,
      nEff,
      comps: adjusted.length,
      // If local dominates the posterior, call it local; otherwise blend.
      basis: fracLocal > 0.7 ? 'local' : 'blend',
    };
  }

  // No usable prior — local only (rare; only when both offset and trend are
  // missing for this cohort).
  return {
    anchorLevel: lLocal,
    predSD: Math.sqrt(V),
    nEff,
    comps: adjusted.length,
    basis: 'local',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function weightedMedian(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return median(values);
  const items = values
    .map((v, i) => ({ v, w: weights[i] }))
    .sort((a, b) => a.v - b.v);
  const half = total / 2;
  let cum = 0;
  for (const it of items) {
    cum += it.w;
    if (cum >= half) return it.v;
  }
  return items[items.length - 1].v;
}

function pickByCandidatePriority<T>(
  rows: T[],
  candidates: string[],
  keyOf: (row: T) => string
): T | null {
  if (rows.length === 0) return null;
  const order = new Map(candidates.map((c, i) => [c, i]));
  let best: T | null = null;
  let bestPri = Infinity;
  for (const r of rows) {
    const pri = order.get(keyOf(r)) ?? Infinity;
    if (pri < bestPri) {
      bestPri = pri;
      best = r;
    }
  }
  return best;
}

/**
 * Feature-adjust ln(price) using the per-market matrix. Mirrors
 * calculator.ts:107-129 — null features skip (≡ training mean-imputation),
 * tiers → scores (6−interior, 5−exterior, 10−basement), std>0 required,
 * z clamped to ±Z_CLAMP.
 */
function adjustedLogPrice(
  c: CompRow,
  coeff: Map<string, CoefficientRow>
): number {
  let l = Math.log(c.close_price);
  const interiorScore = c.interior_tier !== null ? 6 - c.interior_tier : null;
  const exteriorScore = c.exterior_tier !== null ? 5 - c.exterior_tier : null;
  const basementScore = c.basement_tier !== null ? 10 - c.basement_tier : null;
  const feats: Array<[string, number | null]> = [
    ['building_area_total', c.building_area_total],
    ['lot_width', c.lot_width !== null && c.lot_width > 0 ? c.lot_width : null],
    ['bedrooms_above_grade', c.bedrooms_above_grade],
    ['bathrooms_total_integer', c.bathrooms_total_integer],
    ['parking_total', c.parking_total],
    ['basement_score', basementScore],
    ['interior_score', interiorScore],
    ['exterior_score', exteriorScore],
  ];
  for (const [name, value] of feats) {
    if (value === null) continue;
    const cf = coeff.get(name);
    if (!cf || cf.beta === 0 || !(cf.std > 0)) continue;
    const z = clamp((value - cf.mean) / cf.std, -Z_CLAMP, Z_CLAMP);
    l -= cf.beta * z;
  }
  return l;
}

/** End-of-half-year ISO date matching the trend index's period_end bucketing. */
function periodEndForDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() <= 5 ? `${y}-06-30` : `${y}-12-31`;
}

/** g(t): nearest-neighbor lookup into the trend series. Empty series ⇒ 0. */
function gAt(iso: string, trend: TrendRow[]): number {
  if (trend.length === 0) return 0;
  const pe = periodEndForDate(iso);
  const exact = trend.find((t) => t.period_end === pe);
  if (exact) return exact.level_log;
  const targetMs = new Date(pe).getTime();
  let nearest = trend[0];
  let bestDelta = Math.abs(targetMs - new Date(trend[0].period_end).getTime());
  for (const t of trend) {
    const d = Math.abs(targetMs - new Date(t.period_end).getTime());
    if (d < bestDelta) {
      bestDelta = d;
      nearest = t;
    }
  }
  return nearest.level_log;
}
