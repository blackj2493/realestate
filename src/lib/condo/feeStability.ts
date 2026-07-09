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

// ── Trend estimator (annualized) ─────────────────────────────────────────────
// The building trend is an ANNUALIZED %/yr growth of median fee/sqft, fit as a
// weighted log-slope over in-window sales and shrunk toward the baseline when the
// sample is thin. Validated against SAME-UNIT repeat sales (2026-07): vs the old
// first→last endpoint ratio this cut the median per-building error ~2× and the
// "impossible >25%/yr" rate from 19% to <1%. The old ratio blew up whenever the
// oldest half-year bucket was a small/low outlier — a ratio is unbounded above but
// floored at −100%, so identical noise produced giant fake INCREASES.

// ~2–3%/yr is real Ontario condo-fee inflation (repeat-sale truth median ≈ 2.2%/yr).
// Trends are classified RELATIVE to this baseline, not zero.
export const BASELINE_INFLATION_ANNUAL = 3;

// The trend uses a STRICTER fee/sqft floor than the area benchmark: near-floor
// values ($0.05–0.35) are almost always data errors, and as slope inputs they
// dominate the fit. The area median is outlier-resistant so it keeps PSF_MIN.
export const TREND_PSF_MIN = 0.35;
// A slope needs real support: enough sales, spread over enough time.
export const TREND_MIN_SALES = 6;
export const TREND_MIN_SPAN_YEARS = 0.75;
// Shrink the raw slope toward the baseline: weight = n/(n+K). Thin buildings lean
// on the baseline; dense ones trust their own slope. This kills the noisy tail.
export const TREND_BASELINE_ANNUAL_PCT = 2.5;
export const TREND_SHRINK_K = 12;
// Nothing real moves faster than this; also the display / transition safety clamp.
export const TREND_MAX_ANNUAL_PCT = 40;

// fee/sqft sanity bounds ($/sqft/month). Outside → treated as a data-entry error
// and excluded. Typical Ontario condo fees run ~$0.40–$1.20/sqft; luxury/amenity
// buildings push higher, so the upper bound is generous to avoid over-rejecting.
export const PSF_MIN = 0.05;
export const PSF_MAX = 3.0;

// Living-area sanity bounds (sqft).
export const SQFT_MIN = 100;
export const SQFT_MAX = 20000;

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
  /** Annualized %/yr change of the building's median fee/sqft (robust log-slope). */
  annualPct: number;
  sampleCount: number;
  inclusionsMixed: boolean;
}

/** One sold observation feeding the corp trend (exact date + its fee/sqft). */
export interface CorpSaleInput {
  date: string | number | Date;
  psf: number;
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
    pctVsMedian: number; // signed % vs area median, 2-decimal (−19.25 = 19.25% below)
    sampleCount: number;
    inclusionsMixed: boolean;
  };
  trend:
    | null
    | {
        band: TrendBand;
        /** Annualized %/yr change of the building's median fee/sqft. */
        annualPct: number;
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
      ? Math.round(((unitPsf - stats.medianPsf) / stats.medianPsf) * 10000) / 100
      : 0;
  return { position, pctVsMedian };
}

export function classifyTrend(annualPct: number): TrendBand {
  if (annualPct <= BASELINE_INFLATION_ANNUAL) return 'Stable'; // ≤ ~3%/yr (at/below inflation, or falling)
  if (annualPct <= 6) return 'Moderate';                       // above inflation but not alarming
  if (annualPct <= 10) return 'Rising';
  return 'Steep';                                              // >10%/yr — genuinely aggressive
}

export function trendConfidence(sampleCount: number, periods: number): Confidence {
  if (sampleCount >= 16 && periods >= 4) return 'HIGH';
  if (sampleCount >= MIN_CORP_SAMPLE && periods >= MIN_CORP_PERIODS) return 'MEDIUM';
  return 'LOW';
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Fractional calendar year for a date, e.g. 2024-07-02 ≈ 2024.5. */
function decimalYear(d: Date): number {
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const next = Date.UTC(y + 1, 0, 1);
  return y + (d.getTime() - start) / (next - start);
}

/**
 * Annualized %/yr growth of fee/sqft from a WEIGHTED LOG-SLOPE over the sales,
 * shrunk toward the baseline when the sample is thin, then clamped. Returns null
 * when there aren't enough sales / time span to fit a slope.
 *
 * Why a log-slope, not first→last: it uses every sale (not just two noisy
 * endpoints), can't blow up on a tiny denominator, and is symmetric in %-space so
 * equal up/down moves are treated equally (the old ratio was floored at −100% but
 * unbounded above → systematic fake increases). Shrinkage (weight = n/(n+K)) pulls
 * thin, noisy buildings toward the ~2.5%/yr baseline. Deterministic; pure.
 */
export function annualFeeTrendPct(sales: { t: number; psf: number }[]): number | null {
  const pts = sales.filter((s) => s.psf >= TREND_PSF_MIN);
  if (pts.length < TREND_MIN_SALES) return null;
  let tmin = Infinity;
  let tmax = -Infinity;
  for (const p of pts) {
    if (p.t < tmin) tmin = p.t;
    if (p.t > tmax) tmax = p.t;
  }
  if (tmax - tmin < TREND_MIN_SPAN_YEARS) return null;

  const n = pts.length;
  let mt = 0;
  let my = 0;
  for (const p of pts) {
    mt += p.t;
    my += Math.log(p.psf);
  }
  mt /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    const dt = p.t - mt;
    sxx += dt * dt;
    sxy += dt * (Math.log(p.psf) - my);
  }
  if (sxx <= 0) return null;

  const slope = sxy / sxx; // d ln(fee/sqft) / year
  let annual = (Math.exp(slope) - 1) * 100; // continuous → annual growth, %
  const w = n / (n + TREND_SHRINK_K); // shrink toward baseline when thin
  annual = w * annual + (1 - w) * TREND_BASELINE_ANNUAL_PCT;
  return round4(Math.max(-TREND_MAX_ANNUAL_PCT, Math.min(TREND_MAX_ANNUAL_PCT, annual)));
}

/**
 * Assemble a building's fee/sqft trend from its in-window sold observations, or
 * return null when too sparse/noisy to be trustworthy.
 *
 * Two independent pieces:
 *   • Chart buckets — half-year medians (low-n buckets dropped via MIN_BUCKET_N so
 *     a single sale can't anchor a period); gated on MIN_CORP_PERIODS + MIN_CORP_SAMPLE.
 *   • annualPct — a robust annualized log-slope over the raw sales (annualFeeTrendPct),
 *     NOT the endpoint ratio. This is the headline number the card shows.
 *
 * Shared by the aggregation job and tests. Deterministic; pure.
 */
export function assembleCorpStats(
  sales: CorpSaleInput[],
  inclusionsMixed: boolean
): CorpStats | null {
  const parsed = sales
    .map((s) => {
      const d = s.date instanceof Date ? s.date : new Date(s.date as string);
      if (Number.isNaN(d.getTime())) return null;
      const period = halfYearPeriod(d.toISOString());
      return period ? { t: decimalYear(d), psf: s.psf, period } : null;
    })
    .filter((x): x is { t: number; psf: number; period: string } => x !== null);

  // ── Chart buckets (half-year medians, low-n dropped, lexically sorted) ──
  const byPeriod = new Map<string, number[]>();
  for (const p of parsed) {
    const arr = byPeriod.get(p.period) || [];
    arr.push(p.psf);
    byPeriod.set(p.period, arr);
  }
  const entries = [...byPeriod.entries()]
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

  // ── Robust annualized trend (independent of the chart bucketing) ──
  const annualPct = annualFeeTrendPct(parsed);
  if (annualPct === null) return null;

  return { buckets, annualPct, sampleCount, inclusionsMixed };
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
  // below thresholds) → trend stays null. The |annualPct| ≤ MAX guard also
  // suppresses any stale/absurd stored value (e.g. a pre-rework 24mo-cumulative
  // number) so the transition can never surface an impossible "%/yr".
  let trend: FeeStabilityResult['trend'] = null;
  if (
    corp &&
    corp.sampleCount >= MIN_CORP_SAMPLE &&
    corp.buckets.length >= MIN_CORP_PERIODS &&
    Number.isFinite(corp.annualPct) &&
    Math.abs(corp.annualPct) <= TREND_MAX_ANNUAL_PCT
  ) {
    trend = {
      band: classifyTrend(corp.annualPct),
      annualPct: corp.annualPct,
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
