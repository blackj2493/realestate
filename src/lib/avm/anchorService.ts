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
import type { AVMInput, AnchorBasis, AvmTuning } from './types';
import {
  COMP_WINDOW_MO,
  H_DAYS,
  SIGMA2,
  HUBER_K,
  Z_CLAMP,
  MIN_PEER_NEFF,
  BW_BEDS,
  BW_BATHS,
  BW_LOT,
  BW_SQFT,
  SALE_TRANSACTION_TYPE,
  MIN_CLOSE_PRICE,
  DEFAULT_TUNING,
  resolveTau2,
} from './types';
import type { CoefficientRow } from './matrixService';
import { rawVariantsOf, cityRegionLookupCandidates, fsaOf } from './normalizeType';
import { subjectAdjustmentTotal } from './features';

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

export interface CompRow {
  close_price: number;
  purchase_contract_date: string | null;
  close_date: string | null;
  building_area_total: number | null;
  lot_width: number | null;
  lot_depth: number | null;
  bedrooms_above_grade: number | null;
  /** Den / below-grade bedrooms. MUST be selected and MUST appear in
   *  adjustedLogPrice's feature list: the subject premium includes the plus-room
   *  term, so a comp neutralized without it leaves the difference sitting in the
   *  anchor and biases every estimate that uses these comps. */
  bedrooms_below_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  interior_tier: number | null;
  exterior_tier: number | null;
  basement_tier: number | null;
  /** Full 6-char postal for hierarchical geo weighting. Optional: when the column is
   * still FSA-truncated (legacy rows) or null, geo weighting degrades gracefully. */
  postal_code?: string | null;
}

/** Scalar columns pulled for both the standard anchor and the peer comp-grid.
 *  postal_code is FSA-only on legacy rows; backfill it from raw_payload->>PostalCode to
 *  unlock full block/building-level geo weighting (see geoMatchWeight). */
const COMP_SELECT =
  'close_price, purchase_contract_date, close_date, building_area_total, ' +
  'lot_width, lot_depth, bedrooms_above_grade, bedrooms_below_grade, bathrooms_total_integer, parking_total, ' +
  'interior_tier, exterior_tier, basement_tier, postal_code';

/** Normalize a postal code to compact uppercase (no spaces). */
function normPostal(p: string | null | undefined): string {
  return (p ?? '').replace(/\s+/g, '').toUpperCase();
}

/**
 * Hierarchical geographic comp weight: a multiplicative upweight for comps near the
 * subject. Same full 6-char postal (same building/block) → geoFull; same first 4
 * (FSA + first LDU char, a block cluster) → geoBlock; same FSA (first 3, the
 * neighbourhood) → geoFsa; otherwise 1.0. Returns 1.0 when either postal is unknown,
 * so the estimate is unchanged for subjects/comps without a postal. Pure, deterministic.
 */
export function geoMatchWeight(
  subjectPostal: string | null | undefined,
  compPostal: string | null | undefined,
  tuning: AvmTuning
): number {
  const s = normPostal(subjectPostal);
  const c = normPostal(compPostal);
  if (s.length < 3 || c.length < 3) return 1;
  if (s.length >= 6 && c.length >= 6 && s === c) return tuning.geoFull;
  if (s.length >= 4 && c.length >= 4 && s.slice(0, 4) === c.slice(0, 4)) return tuning.geoBlock;
  if (s.slice(0, 3) === c.slice(0, 3)) return tuning.geoFsa;
  return 1;
}

export interface TrendRow {
  period_end: string;
  level_log: number;
}

export interface OffsetRow {
  city_region: string;
  delta_log: number;
}

/**
 * Market data the pure anchor math consumes, injected by the caller. fetchAnchor
 * fills it from live DB queries with nowMs = Date.now(); the out-of-time backtest
 * harness fills it with as-of data — comps dated < t_S, an as-of trend/offset
 * snapshot — and nowMs = t_S, so the SAME math replays with zero look-ahead leakage.
 */
export interface AnchorInputData {
  comps: CompRow[];
  /** {period_end, level_log}, most-recent period first (as the live query orders). */
  trend: TrendRow[];
  /** {city_region, delta_log} for the subject's city_region candidates. */
  offsets: OffsetRow[];
  /** "now" in epoch ms — Date.now() in the live path, the sale's reference date (t_S) in the backtest. */
  nowMs: number;
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
  const subVariants = rawVariantsOf(input.propertySubType, input.rawPropertySubType);
  if (subVariants.length === 0) return UNAVAILABLE;

  // City drives the trend lookup; null City falls back to cityRegion (usually
  // misses avm_trend_index, prior chain then handles it).
  const cityKey = (input.city ?? input.cityRegion).trim();
  const subKey = input.propertySubType.toLowerCase().trim();

  const windowStart = new Date();
  windowStart.setUTCMonth(windowStart.getUTCMonth() - COMP_WINDOW_MO);
  const windowStartIso = windowStart.toISOString().slice(0, 10);

  // No community key at all. This used to `return UNAVAILABLE` — and because
  // estimateFromMarketData short-circuits on basis 'none' BEFORE the peer branch, that
  // one line made every downstream rescue unreachable and zeroed whole municipalities
  // (Waterloo Region + Brantford ship no CityRegion on either side of the comp join).
  // Anchor on the postal FSA instead; returning a REAL anchor is what keeps the rest
  // of the pipeline — peer routing, bands, confidence — working normally.
  if (cityRegionCandidates.length === 0) {
    return fetchGeoFallbackAnchor(supabase, input, coefficients, basePriceFallback, {
      subVariants,
      cityKey,
      subKey,
      windowStartIso,
    });
  }

  // 3 indexed queries in parallel: comps + trend series + community offset.
  const [compsRes, trendRes, offsetRes] = await Promise.all([
    supabase
      .from('raw_vow_sold')
      .select(COMP_SELECT)
      .in('city_region', cityRegionCandidates)
      .in('property_sub_type', subVariants)
      .eq('transaction_type', SALE_TRANSACTION_TYPE)
      .gte('close_price', MIN_CLOSE_PRICE)
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

  return computeAnchorFromData(input, coefficients, basePriceFallback, {
    comps: (compsRes.data as unknown as CompRow[] | null) ?? [],
    trend: (trendRes.data as unknown as TrendRow[] | null) ?? [],
    offsets: (offsetRes.data as unknown as OffsetRow[] | null) ?? [],
    nowMs: Date.now(),
  });
}

/**
 * Anchor for subjects with NO CityRegion — the feed omits it for entire municipalities
 * (all of Waterloo Region, Brantford). Two rungs, tightest geography first:
 *
 *   1. postal FSA  — neighbourhood scale, and the reason this is worth doing. predSD is
 *      √(estVar + scale²) where `scale` is the comp pool's irreducible spread and does
 *      NOT shrink as comps are added. Anchoring on the whole municipality would fold
 *      every neighbourhood into `scale` and hand back a wide LOW band even at nEff 45+;
 *      an FSA pool keeps `scale` where a community cohort would have it.
 *   2. city-wide   — only when the FSA is absent/too thin. Genuinely more dispersed, and
 *      the wider band it produces says so. Honest, not free.
 *
 * The community OFFSET is deliberately not fetched: δ_c is defined relative to the city
 * mean, so at a granularity inside the city it is legitimately zero. computeAnchorFromData
 * then seeds the prior from the city trend alone ('parent' basis) — the correct prior
 * here, not an approximation. Geo weighting still applies within the pool, so comps on
 * the subject's own block outrank comps across the FSA.
 */
async function fetchGeoFallbackAnchor(
  supabase: SupabaseClient,
  input: AVMInput,
  coefficients: CoefficientRow[],
  basePriceFallback: number | null,
  ctx: { subVariants: string[]; cityKey: string; subKey: string; windowStartIso: string }
): Promise<AnchorResult> {
  const { subVariants, cityKey, subKey, windowStartIso } = ctx;
  if (!cityKey) return UNAVAILABLE;

  const fsa = fsaOf(input.postalCode);

  // Trend is city-keyed and shared by both rungs — fetch it once, alongside rung 1.
  const [fsaRes, trendRes] = await Promise.all([
    fsa
      ? supabase.rpc('sold_fsa_comps', {
          p_fsa: fsa,
          p_city: cityKey,
          p_sub_types: subVariants,
          p_price_floor: MIN_CLOSE_PRICE,
          p_cutoff: windowStartIso,
          p_limit: MAX_COMPS,
        })
      : Promise.resolve({ data: null }),
    supabase
      .from('avm_trend_index')
      .select('period_end, level_log')
      .ilike('city', cityKey)
      .ilike('property_sub_type', subKey)
      .order('period_end', { ascending: false })
      .limit(8),
  ]);

  const trend = (trendRes.data as unknown as TrendRow[] | null) ?? [];
  let comps = (fsaRes.data as unknown as CompRow[] | null) ?? [];

  // Rung 2 — city-wide. MIN_PEER_NEFF is the same bar every other geography rung
  // clears (fetchPeerAnchor), applied here on raw count before weighting.
  if (comps.length < MIN_PEER_NEFF) {
    const cityRes = await supabase.rpc('sold_city_comps', {
      p_city: cityKey,
      p_sub_types: subVariants,
      p_price_floor: MIN_CLOSE_PRICE,
      p_cutoff: windowStartIso,
      p_limit: MAX_COMPS,
    });
    const cityComps = (cityRes.data as unknown as CompRow[] | null) ?? [];
    if (cityComps.length > comps.length) comps = cityComps;
  }

  return computeAnchorFromData(input, coefficients, basePriceFallback, {
    comps,
    trend,
    offsets: [],
    nowMs: Date.now(),
  });
}

/**
 * Pure anchor math over INJECTED market data — the deterministic core of the
 * anchor pipeline (steps 2–6). fetchAnchor wraps this with live DB queries and
 * nowMs = Date.now(); the out-of-time backtest harness calls it directly with
 * as-of data (comps dated < t_S, an as-of trend/offset snapshot, nowMs = t_S) so
 * it replays the EXACT request-time model with zero look-ahead leakage.
 * Behaviour is byte-identical to the pre-extraction fetchAnchor tail.
 * Deterministic, no AI (CLAUDE.md §4).
 */
export function computeAnchorFromData(
  input: AVMInput,
  coefficients: CoefficientRow[],
  basePriceFallback: number | null,
  data: AnchorInputData,
  tuning: AvmTuning = DEFAULT_TUNING
): AnchorResult {
  const cityRegionCandidates = cityRegionLookupCandidates(input.cityRegion);
  const comps = data.comps.filter(
    (c) => c.close_price > 0 && (c.purchase_contract_date || c.close_date)
  );
  const { trend, offsets, nowMs } = data;

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
      predSD: tuning.priorSd,
      nEff: 0,
      comps: 0,
      basis: priorBasisSeed,
    };
  }

  // ── Per-comp ℓ_i, de-staled to now ───────────────────────────────────────
  const coeff = new Map(coefficients.map((c) => [c.featureName, c]));

  type Adjusted = { l: number; ageDays: number; geoW: number };
  const adjusted: Adjusted[] = [];
  for (const c of comps) {
    const dateIso = c.purchase_contract_date || c.close_date!;
    const lRaw = adjustedLogPrice(c, coeff);
    const gPrime = gNow !== null ? gNow - gAt(dateIso, trend) : 0;
    const l = lRaw + gPrime;
    if (!Number.isFinite(l)) continue;
    const ageDays = Math.max(0, (nowMs - new Date(dateIso).getTime()) / (1000 * 86400));
    const geoW = geoMatchWeight(input.postalCode, c.postal_code, tuning);
    adjusted.push({ l, ageDays, geoW });
  }

  if (adjusted.length === 0) {
    if (priorLevel === null) return UNAVAILABLE;
    return {
      anchorLevel: priorLevel,
      predSD: tuning.priorSd,
      nEff: 0,
      comps: 0,
      basis: priorBasisSeed,
    };
  }

  // ── Robust, recency- (and geo-) weighted local estimate ──────────────────
  // geoW (1.0 when no postal / geo off) upweights comps in the subject's own pocket,
  // so the local level reflects the home's block, not the whole community average.
  const recencyW = adjusted.map((a) => Math.exp(-a.ageDays / H_DAYS) * a.geoW);
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
      predSD: tuning.priorSd,
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
    // Prior variance is nEff-adaptive (DEFAULT_TUNING → flat TAU2): comp-rich cohorts
    // weaken the prior so an expensive home escapes the pull to the community median.
    const wPrior = 1 / resolveTau2(tuning, nEff);
    const anchorLevel = (wLocal * lLocal + wPrior * priorLevel) / (wLocal + wPrior);
    const estVar = 1 / (wLocal + wPrior);
    // PREDICTION interval for THIS home, not a confidence interval for the mean:
    // add the irreducible spread of comparable sales (robust `scale`, an as-of
    // quantity computed only from comps dated < t — leakage-safe). The legacy mode
    // returns only the estimation SD, which collapses to ~4% and undercovers ~3.7×.
    const predSD =
      tuning.predMode === 'predictive' ? Math.sqrt(estVar + scale * scale) : Math.sqrt(estVar);
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
    predSD: tuning.predMode === 'predictive' ? Math.sqrt(V + scale * scale) : Math.sqrt(V),
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
    ['bedrooms_below_grade', c.bedrooms_below_grade],
    ['bathrooms_total_integer', c.bathrooms_total_integer],
    ['parking_total', c.parking_total],
    ['basement_score', basementScore],
    ['interior_score', interiorScore],
    ['exterior_score', exteriorScore],
  ];
  for (const [name, value] of feats) {
    // `== null` on purpose: a comp from an RPC that does not RETURN a column carries
    // `undefined`, not null. Before migration 134, sold_fsa_comps and sold_city_comps
    // omitted bedrooms_below_grade, so `(undefined − mean) / std` was NaN and every comp
    // from those rungs was silently dropped the moment any coefficients were applied —
    // the anchor fell to the prior alone (predSD 0.22 → LOW) and the peer search found
    // nothing (→ floor). That, not the ladder, was what #452 measured.
    if (value == null) continue;
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

// ─────────────────────────────────────────────────────────────────────────────
// Peer comp-grid (atypical / high-end homes — basis 'peer')
// ─────────────────────────────────────────────────────────────────────────────

/** Lot magnitude for similarity: area when both sides have depth, else width. */
function lotSimLog(subject: AVMInput, c: CompRow): number {
  const sw = subject.lotWidth;
  const sd = subject.lotDepth ?? null;
  const cw = c.lot_width;
  const cd = c.lot_depth;
  let sVal: number | null = null;
  let cVal: number | null = null;
  if (sw && sw > 0 && sd && sd > 0 && cw && cw > 0 && cd && cd > 0) {
    sVal = sw * sd;
    cVal = cw * cd;
  } else if (sw && sw > 0 && cw && cw > 0) {
    sVal = sw;
    cVal = cw;
  }
  if (sVal && cVal) return -0.5 * (Math.log(sVal / cVal) / BW_LOT) ** 2;
  return 0;
}

/** Gaussian similarity on the size proxies the comps actually carry. Missing dims
 *  contribute nothing (factor 1), so a sparse comp isn't penalised, only un-weighted.
 *  Exported for unit testing. */
export function similarityWeight(subject: AVMInput, c: CompRow): number {
  let logw = 0;
  if (subject.bedroomsAboveGrade != null && c.bedrooms_above_grade != null) {
    logw += -0.5 * ((subject.bedroomsAboveGrade - c.bedrooms_above_grade) / BW_BEDS) ** 2;
  }
  if (subject.bathroomsTotalInteger != null && c.bathrooms_total_integer != null) {
    logw += -0.5 * ((subject.bathroomsTotalInteger - c.bathrooms_total_integer) / BW_BATHS) ** 2;
  }
  if (subject.buildingAreaTotal && subject.buildingAreaTotal > 0 && c.building_area_total && c.building_area_total > 0) {
    logw += -0.5 * (Math.log(subject.buildingAreaTotal / c.building_area_total) / BW_SQFT) ** 2;
  }
  logw += lotSimLog(subject, c);
  return Math.exp(logw);
}

/**
 * Pure peer comp-grid: price the SUBJECT off homes like it. Each comp is adjusted
 * to the subject's feature level
 *   predicted_i = [ln(price_i) − Σβ·z_comp_i] + Σβ·z_subject + (g(now) − g(t_i))
 * then combined by a recency×similarity-weighted Huber-robust mean. NO ADJ_CLAMP —
 * the adjustment is the small delta between similar homes, not a capped extrapolation.
 * predSD is the weighted dispersion of comparable sales (an honest band). Returns
 * null when no usable comp survives. Deterministic, no AI (CLAUDE.md §4).
 */
export function peerLevelFromComps(
  subject: AVMInput,
  comps: CompRow[],
  coefficients: CoefficientRow[],
  trend: TrendRow[],
  nowMs: number,
  basis: AnchorBasis = 'peer',
  tuning: AvmTuning = DEFAULT_TUNING
): AnchorResult | null {
  const usable = comps.filter(
    (c) => c.close_price > 0 && (c.purchase_contract_date || c.close_date)
  );
  if (usable.length === 0) return null;

  const coeff = new Map(coefficients.map((c) => [c.featureName, c]));
  const subjPremium = subjectAdjustmentTotal(subject, coeff);
  const gNow = trend[0]?.level_log ?? null;

  const preds: number[] = [];
  const weights: number[] = [];
  for (const c of usable) {
    const dateIso = c.purchase_contract_date || c.close_date!;
    const neutralized = adjustedLogPrice(c, coeff); // ln(price) − Σβ·z_comp
    const destale = gNow !== null ? gNow - gAt(dateIso, trend) : 0;
    const predicted = neutralized + subjPremium + destale;
    if (!Number.isFinite(predicted)) continue;
    const ageDays = Math.max(0, (nowMs - new Date(dateIso).getTime()) / (1000 * 86400));
    const w = Math.exp(-ageDays / H_DAYS) * similarityWeight(subject, c) * geoMatchWeight(subject.postalCode, c.postal_code, tuning);
    if (!(w > 0)) continue;
    preds.push(predicted);
    weights.push(w);
  }
  if (preds.length === 0) return null;

  // Robust: Huber-downweight residuals around the weighted median.
  const wmed = weightedMedian(preds, weights);
  const resid = preds.map((p) => p - wmed);
  const scale = (median(resid.map(Math.abs)) || 1e-6) * 1.4826;
  const w2 = weights.map((w, i) => {
    const z = Math.abs(resid[i]) / scale;
    return w * (z <= HUBER_K ? 1 : HUBER_K / z);
  });
  const sumW = w2.reduce((a, b) => a + b, 0);
  if (!(sumW > 0)) return null;

  const center = preds.reduce((a, p, i) => a + p * w2[i], 0) / sumW;
  const sumW2 = w2.reduce((a, x) => a + x * x, 0);
  const nEff = (sumW * sumW) / sumW2;
  const variance = preds.reduce((a, p, i) => a + w2[i] * (p - center) ** 2, 0) / sumW;
  // PREDICTION interval for THIS home: the comp dispersion (√variance) is the
  // irreducible spread of comparable sales and does NOT shrink with n; add the
  // standard-error-of-the-mean term (variance/nEff) for estimation uncertainty.
  // Legacy mode returns only the SE-of-the-mean, which collapses to ~2-4% and trips
  // overconfident bands. predictive: predSD = √(variance·(1 + 1/nEff)).
  const safeVar = Math.max(variance, 0);
  const predSD =
    tuning.predMode === 'predictive'
      ? Math.max(Math.sqrt(safeVar * (1 + 1 / Math.max(nEff, 1))), 0.02)
      : Math.max(Math.sqrt(safeVar / Math.max(nEff, 1)), 0.02);

  return { anchorLevel: center, predSD, nEff, comps: usable.length, basis };
}

/**
 * Coefficient-free, market-relative atypicality: how many std-devs the subject sits
 * from its local comp distribution on the size proxies the comps carry (beds-above-
 * grade, baths, log lot width). Returns the max |z| across available dimensions, or
 * 0 when the cohort is too small (< 3 comps) or has no variance to judge against.
 * Used to flag outliers in UNTRAINED cohorts where Σβz is unavailable. No list price.
 */
export function cohortOutlierScore(subject: AVMInput, comps: CompRow[]): number {
  const zOf = (
    subj: number | null | undefined,
    getComp: (c: CompRow) => number | null,
    tf: (x: number) => number = (x) => x
  ): number | null => {
    if (subj == null || !(subj > 0)) return null;
    const xs = comps.map(getComp).filter((v): v is number => v != null && v > 0).map(tf);
    if (xs.length < 3) return null;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    if (!(sd > 0)) return null;
    return (tf(subj) - mean) / sd;
  };
  const zs = [
    zOf(subject.bedroomsAboveGrade, (c) => c.bedrooms_above_grade),
    zOf(subject.bathroomsTotalInteger, (c) => c.bathrooms_total_integer),
    zOf(subject.lotWidth, (c) => c.lot_width, Math.log),
  ].filter((z): z is number => z != null);
  if (zs.length === 0) return 0;
  return Math.max(...zs.map((z) => Math.abs(z)));
}

/**
 * Fetch a peer anchor for an outlier, escalating geography until a rung carries
 * enough effective peers (≥ MIN_PEER_NEFF): community → city-wide.
 *   • AnchorResult → peers found (basis 'peer').
 *   • null         → flagged outlier but too few peers → caller shows a FLOOR.
 *   • undefined    → UNTRAINED cohort (no coefficients) where the home turns out
 *                    TYPICAL for its community → caller leaves the normal estimate.
 * For trained cohorts (coefficients present) the caller already decided via Σβz, so
 * the atypicality gate is skipped and only AnchorResult|null are returned.
 * Independent of list price (CLAUDE.md §2). Reads raw_vow_sold READ-ONLY (§12).
 */
export async function fetchPeerAnchor(
  supabase: SupabaseClient,
  subject: AVMInput,
  coefficients: CoefficientRow[]
): Promise<AnchorResult | null | undefined> {
  const subVariants = rawVariantsOf(subject.propertySubType, subject.rawPropertySubType);
  if (subVariants.length === 0) return undefined;

  const cityKey = (subject.city ?? subject.cityRegion).trim();
  const subKey = subject.propertySubType.toLowerCase().trim();
  const windowStart = new Date();
  windowStart.setUTCMonth(windowStart.getUTCMonth() - COMP_WINDOW_MO);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const nowMs = Date.now();

  const trendRes = await supabase
    .from('avm_trend_index')
    .select('period_end, level_log')
    .ilike('city', cityKey)
    .ilike('property_sub_type', subKey)
    .order('period_end', { ascending: false })
    .limit(8);
  const trend = (trendRes.data as unknown as TrendRow[] | null) ?? [];

  // Rung 1 — community (city_region candidates).
  const cands = cityRegionLookupCandidates(subject.cityRegion);
  // If no community candidates and no city, there is nothing to search.
  if (cands.length === 0 && !cityKey) return undefined;
  if (cands.length > 0) {
    const res = await supabase
      .from('raw_vow_sold')
      .select(COMP_SELECT)
      .in('city_region', cands)
      .in('property_sub_type', subVariants)
      .eq('transaction_type', SALE_TRANSACTION_TYPE)
      .gte('close_price', MIN_CLOSE_PRICE)
      .gte('purchase_contract_date', windowStartIso)
      .order('purchase_contract_date', { ascending: false })
      .limit(MAX_COMPS);
    const communityComps = ((res.data as unknown as CompRow[] | null) ?? []);

    // Untrained cohorts always proceed to peerLevelFromComps (no blind average).
    // The previous atypicality early-return is removed; thin-comp cases fall through
    // to rung 2 / null, which the caller relabels honestly (not 'floor').
    const peer = peerLevelFromComps(subject, communityComps, coefficients, trend, nowMs);
    if (peer && peer.nEff >= MIN_PEER_NEFF) return peer;
  }

  // Rung 1b — postal FSA. Sits between community and city because it is neighbourhood-
  // scale: without it, a subject whose feed carries no CityRegion (Waterloo Region,
  // Brantford) skips straight from "no community" to a whole-municipality peer pool,
  // which is exactly the dispersion the FSA anchor was added to avoid. Only worth a
  // query when the community rung had no key — a subject WITH a community that came up
  // thin has already told us its neighbourhood is short of comps.
  if (cands.length === 0) {
    const fsa = fsaOf(subject.postalCode);
    if (fsa && cityKey) {
      const res = await supabase.rpc('sold_fsa_comps', {
        p_fsa: fsa,
        p_city: cityKey,
        p_sub_types: subVariants,
        p_price_floor: MIN_CLOSE_PRICE,
        p_cutoff: windowStartIso,
        p_limit: MAX_COMPS,
      });
      const peer = peerLevelFromComps(
        subject,
        ((res.data as unknown as CompRow[] | null) ?? []),
        coefficients,
        trend,
        nowMs
      );
      if (peer && peer.nEff >= MIN_PEER_NEFF) return peer;
    }
  }

  // Rung 2 — city-wide (broader pool of homes like it).
  // Via RPC (migration 099) rather than .ilike('city', …): ILIKE could not use
  // idx_vow_sold_city_lower_pcd, so this seq-scanned ~289k rows per call — 52,676 calls
  // @ 128 ms over 4.2d, mostly from the twice-weekly estimates sweep. The RPC returns
  // COMP_SELECT's columns in the same order; see migration 099 for the mapping.
  if (cityKey) {
    const res = await supabase.rpc('sold_city_comps', {
      p_city: cityKey,
      p_sub_types: subVariants,
      // The RPC now filters transaction_type = 'For Sale' itself (migration 105),
      // so this is a placeholder guard only, not the lease exclusion.
      p_price_floor: MIN_CLOSE_PRICE,
      p_cutoff: windowStartIso,
      p_limit: MAX_COMPS,
    });
    const peer = peerLevelFromComps(
      subject,
      ((res.data as unknown as CompRow[] | null) ?? []),
      coefficients,
      trend,
      nowMs
    );
    if (peer && peer.nEff >= MIN_PEER_NEFF) return peer;
  }

  // Too few peers anywhere → caller falls back to a clamped neighbourhood FLOOR.
  return null;
}
