/**
 * Condo Fee Stability — deterministic fee/sqft normalization, area benchmarking,
 * and same-corp trend classification.
 *
 * CLAUDE.md §4 compliance: 100% deterministic, hardcoded logic. No LLM, no AI.
 * Pure functions with no side effects (no Supabase, no fetch) — safe to import
 * from both the Next.js app (API route) and the ETL/admin scripts (aggregation
 * job + tests).
 *
 * Two outputs power the listing-page card:
 *   • Area benchmark — this unit's fee/sqft vs the neighbourhood condo distribution.
 *   • Corp trend     — the building's median fee/sqft trajectory over the window.
 *                      Suppressed entirely when the building is too sparse
 *                      (benchmark-only — product decision).
 *
 * Why fee/sqft: condo fees scale with unit size, so per-sqft is the apples-to-apples
 * unit across different-sized units in the same building / neighbourhood.
 */

// ───────────────────────────────────────────────────────────────────────────
// Tunable constants
// ───────────────────────────────────────────────────────────────────────────

// Minimum sold units behind an aggregate. Also the privacy floor: an aggregate
// derived from fewer than this could expose a single VOW sold transaction.
export const MIN_AREA_SAMPLE = 8;
export const MIN_CORP_SAMPLE = 8;
export const MIN_CORP_PERIODS = 3;
// A period bucket needs at least this many sold units to anchor a trend point — a
// single sale's fee/sqft must never define a half-year median (it produces wild,
// misleading swings, e.g. one $2.16/sqft luxury sale → a fake +147% "trend").
export const MIN_BUCKET_N = 2;

// Trailing observation window for both cohorts.
export const WINDOW_MONTHS = 24;

// ~3%/yr compounded over 24mo ≈ 6.09%. Fees naturally rise with inflation, so the
// trend is classified RELATIVE to this baseline, not zero.
export const BASELINE_INFLATION_24MO = 6;

// fee/sqft sanity bounds ($/sqft/month). Outside → treated as a data-entry error
// and excluded. Typical Ontario condo fees run ~$0.40–$1.20/sqft; luxury/amenity
// buildings push higher, so the upper bound is generous to avoid over-rejecting.
export const PSF_MIN = 0.05;
export const PSF_MAX = 3.0;

// Living-area sanity bounds (sqft).
const SQFT_MIN = 100;
const SQFT_MAX = 20000;

// PropertySubType tokens that identify a condo/strata interest.
const CONDO_SUBTYPE_TOKENS = [
  'condo',
  'co-op',
  'co operative',
  'cooperative',
  'comm element',
  'common element',
  'leasehold condo',
];

// AssociationFeeIncludes tokens that indicate bundled utilities (the differentiators
// that make a raw fee comparison apples-to-oranges; 'common elements' / 'building
// insurance' / 'parking' are near-universal and intentionally excluded here).
const BUNDLED_UTILITY_TOKENS = [
  'heat',
  'hydro',
  'electric',
  'water',
  'cac',
  'central air',
  'air condition',
];

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

type Payload = Record<string, unknown> | null | undefined;

export type AreaPosition = 'below' | 'typical' | 'above';
export type TrendBand = 'Stable' | 'Moderate' | 'Rising' | 'Steep';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TrendBucket {
  period: string; // e.g. "2024-H1", oldest → newest
  medianPsf: number;
  n: number;
}

export interface AreaStats {
  medianPsf: number;
  p25Psf: number;
  p75Psf: number;
  sampleCount: number;
  inclusionsMixed: boolean;
}

export interface CorpStats {
  buckets: TrendBucket[];
  pctChange24mo: number;
  sampleCount: number;
  inclusionsMixed: boolean;
}

export interface FeeStabilityResult {
  available: boolean;
  reason?: string;
  unitFeePsf?: number;
  area?: {
    cityRegion: string;
    medianPsf: number;
    p25Psf: number;
    p75Psf: number;
    position: AreaPosition;
    pctVsMedian: number; // signed % vs area median (−19 = 19% below)
    sampleCount: number;
    inclusionsMixed: boolean;
  };
  trend:
    | null
    | {
        band: TrendBand;
        pctChange24mo: number;
        buckets: TrendBucket[];
        confidence: Confidence;
        sampleCount: number;
      };
}

// ───────────────────────────────────────────────────────────────────────────
// Coercion / parsing helpers
// ───────────────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/**
 * Parse a TRREB LivingAreaRange bucket string ("1500-2000", "5000+", "700") to a
 * representative sqft (midpoint for ranges). Returns null when unparseable.
 */
export function parseLivingAreaRange(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  const range = s.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return Math.round((Number(range[1]) + Number(range[2])) / 2);
  const open = s.match(/(\d+)\s*\+/);
  if (open) return Number(open[1]);
  const single = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(single) && single > 0 ? Math.round(single) : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Condo detection / sqft / fee-psf
// ───────────────────────────────────────────────────────────────────────────

export function isCondo(payload: Payload): boolean {
  if (payload?.['AssociationYN'] === true) return true;
  const sub = str(payload?.['PropertySubType']).toLowerCase();
  if (!sub) return false;
  return CONDO_SUBTYPE_TOKENS.some((t) => sub.includes(t));
}

/**
 * Resolve a unit's living area in sqft: exact BuildingAreaTotal preferred, else the
 * LivingAreaRange bucket midpoint. Returns null when neither is usable / in-range.
 */
export function resolveSqft(payload: Payload): number | null {
  const exact = num(payload?.['BuildingAreaTotal']);
  if (exact !== null && exact >= SQFT_MIN && exact <= SQFT_MAX) return exact;
  const fromRange = parseLivingAreaRange(payload?.['LivingAreaRange']);
  if (fromRange !== null && fromRange >= SQFT_MIN && fromRange <= SQFT_MAX) return fromRange;
  return null;
}

/**
 * Monthly fee per sqft. Returns null when inputs are missing or the result falls
 * outside sane bounds (data-entry error → excluded rather than poisoning a cohort).
 */
export function computeFeePsf(fee: unknown, sqft: unknown): number | null {
  const f = num(fee);
  const s = num(sqft);
  if (f === null || f <= 0) return null;
  if (s === null || s <= 0) return null;
  const psf = f / s;
  if (psf < PSF_MIN || psf > PSF_MAX) return null;
  return psf;
}

/**
 * Does this listing's AssociationFeeIncludes bundle differentiating utilities
 * (heat/hydro/water/cac)? Used to flag a cohort as inclusions-mixed.
 */
export function bundlesUtilities(includes: unknown): boolean {
  const tokens = normalizeList(includes);
  return tokens.some((tok) => BUNDLED_UTILITY_TOKENS.some((u) => tok.includes(u)));
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

// ───────────────────────────────────────────────────────────────────────────
// Statistics helpers (shared with the aggregation job)
// ───────────────────────────────────────────────────────────────────────────

/** Linear-interpolated quantile (q in [0,1]) over a numeric array. NaN if empty. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

/** Half-year period label for a date string, e.g. "2024-H1". Empty string if invalid. */
export function halfYearPeriod(dateStr: unknown): string {
  const d = new Date(str(dateStr));
  if (Number.isNaN(d.getTime())) return '';
  const half = d.getUTCMonth() < 6 ? 'H1' : 'H2';
  return `${d.getUTCFullYear()}-${half}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Classification
// ───────────────────────────────────────────────────────────────────────────

export function classifyAreaPosition(
  unitPsf: number,
  stats: { medianPsf: number; p25Psf: number; p75Psf: number }
): { position: AreaPosition; pctVsMedian: number } {
  let position: AreaPosition = 'typical';
  if (unitPsf < stats.p25Psf) position = 'below';
  else if (unitPsf > stats.p75Psf) position = 'above';
  const pctVsMedian =
    stats.medianPsf > 0
      ? Math.round(((unitPsf - stats.medianPsf) / stats.medianPsf) * 100)
      : 0;
  return { position, pctVsMedian };
}

export function classifyTrend(pctChange24mo: number): TrendBand {
  if (pctChange24mo <= BASELINE_INFLATION_24MO) return 'Stable';
  if (pctChange24mo <= 12) return 'Moderate';
  if (pctChange24mo <= 20) return 'Rising';
  return 'Steep';
}

export function trendConfidence(sampleCount: number, periods: number): Confidence {
  if (sampleCount >= 16 && periods >= 4) return 'HIGH';
  if (sampleCount >= MIN_CORP_SAMPLE && periods >= MIN_CORP_PERIODS) return 'MEDIUM';
  return 'LOW';
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Assemble a building's fee/sqft trend from per-period observations, or return null
 * when too sparse/noisy to be trustworthy. Drops low-n buckets (MIN_BUCKET_N) so a
 * single sale can't anchor a period, then requires MIN_CORP_PERIODS qualifying
 * buckets and MIN_CORP_SAMPLE total. pctChange24mo is taken across the qualifying
 * endpoints. Shared by the aggregation job and tests.
 */
export function assembleCorpStats(
  byPeriod: Map<string, number[]> | [string, number[]][],
  inclusionsMixed: boolean
): CorpStats | null {
  const entries = (Array.isArray(byPeriod) ? byPeriod : [...byPeriod.entries()])
    .filter(([, vals]) => vals.length >= MIN_BUCKET_N)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); // "YYYY-Hn" sorts lexically

  if (entries.length < MIN_CORP_PERIODS) return null;

  const buckets: TrendBucket[] = entries.map(([period, vals]) => ({
    period,
    medianPsf: round4(median(vals)),
    n: vals.length,
  }));
  const sampleCount = buckets.reduce((s, b) => s + b.n, 0);
  if (sampleCount < MIN_CORP_SAMPLE) return null;

  const first = buckets[0].medianPsf;
  const last = buckets[buckets.length - 1].medianPsf;
  const pctChange24mo = first > 0 ? round4(((last - first) / first) * 100) : 0;

  return { buckets, pctChange24mo, sampleCount, inclusionsMixed };
}

// ───────────────────────────────────────────────────────────────────────────
// Orchestrator — assemble the card payload from the unit + precomputed cohorts.
// ───────────────────────────────────────────────────────────────────────────

export function buildFeeStabilityResult(args: {
  payload: Payload;
  cityRegion: string;
  area: AreaStats | null;
  corp: CorpStats | null;
}): FeeStabilityResult {
  const { payload, cityRegion, area, corp } = args;

  if (!isCondo(payload)) {
    return { available: false, reason: 'not_condo', trend: null };
  }

  const sqft = resolveSqft(payload);
  const unitFeePsf = computeFeePsf(payload?.['AssociationFee'], sqft);
  if (unitFeePsf === null) {
    return { available: false, reason: 'no_unit_fee_or_sqft', trend: null };
  }

  if (!area || area.sampleCount < MIN_AREA_SAMPLE) {
    return { available: false, reason: 'insufficient_area_data', unitFeePsf, trend: null };
  }

  const { position, pctVsMedian } = classifyAreaPosition(unitFeePsf, area);

  // Corp trend — benchmark-only when the building is too sparse (no corp row or
  // below thresholds) → trend stays null.
  let trend: FeeStabilityResult['trend'] = null;
  if (
    corp &&
    corp.sampleCount >= MIN_CORP_SAMPLE &&
    corp.buckets.length >= MIN_CORP_PERIODS
  ) {
    trend = {
      band: classifyTrend(corp.pctChange24mo),
      pctChange24mo: corp.pctChange24mo,
      buckets: corp.buckets,
      confidence: trendConfidence(corp.sampleCount, corp.buckets.length),
      sampleCount: corp.sampleCount,
    };
  }

  return {
    available: true,
    unitFeePsf,
    area: {
      cityRegion,
      medianPsf: area.medianPsf,
      p25Psf: area.p25Psf,
      p75Psf: area.p75Psf,
      position,
      pctVsMedian,
      sampleCount: area.sampleCount,
      // Caveat fires if either the area cohort or the building cohort mixes inclusions.
      inclusionsMixed: area.inclusionsMixed || corp?.inclusionsMixed === true,
    },
    trend,
  };
}
