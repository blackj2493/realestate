/**
 * AVM FAST EXPERIMENT HARNESS (read-only; writes only a local JSON).
 *
 * Same leakage-safe, out-of-time methodology as avm-backtest.ts, but resolves the
 * model (coefficients / audit R² / sibling) FROM MEMORY instead of one DB round-trip
 * per held-out sale. The matrix is already streamed for the as-of snapshot; here we
 * also preload avm_audit_report and build a city→communities index from the pool, so
 * a 10k-sale replay drops from ~hours (≈100k network calls) to ~2 minutes. The
 * estimate math is the SAME pure functions the live path calls (computeAnchorFromData
 * + peerLevelFromComps + estimateFromMarketData), so numbers stay faithful — validate
 * with `--validate` against the slow harness before trusting deltas.
 *
 * Proper TLS (Supabase serves valid certs). 100% deterministic. raw_vow_sold READ-ONLY.
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/avm-experiment.ts --limit 10000 --variant baseline --out avm-exp-baseline.json
 *   npx.cmd tsx --env-file=.env scripts/admin/avm-experiment.ts --limit 10000 --variant monthly_trend --out avm-exp-v1.json
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import {
  normalizePropertySubType,
  cityRegionLookupCandidates,
  rawVariantsOf,
} from '@/lib/avm/normalizeType';
import {
  aggregateTrendAndOffset,
  periodEndForDate,
  selectTrendSeries,
  selectOffsets,
  type LRecord,
  type Matrix,
  type TrendRow as AggTrendRow,
  type OffsetRow as AggOffsetRow,
  adjustedLogPrice as adjustedLogPriceForAgg,
} from '@/lib/avm/trendOffset';
import {
  computeAnchorFromData,
  peerLevelFromComps,
  type CompRow,
  type AnchorResult,
  type TrendRow,
  type OffsetRow,
} from '@/lib/avm/anchorService';
import { estimateFromMarketData, shouldEvaluatePeers } from '@/lib/avm/calculator';
import { pickSibling } from '@/lib/avm/siblingModel';
import type { CoefficientRow } from '@/lib/avm/matrixService';
import type { AVMInput, AVMResult, AvmTuning } from '@/lib/avm/types';
import { COMP_WINDOW_MO, SALE_TRANSACTION_TYPE, MIN_CLOSE_PRICE as DEFAULT_SALE_PRICE_FLOOR, MIN_PEER_NEFF, DEFAULT_TUNING, LEGACY_TUNING } from '@/lib/avm/types';
import { NEUTRAL_TIER, BASEMENT_NONE_TIER } from '@/lib/avm/conditionScoring';

// ── CLI flags ────────────────────────────────────────────────────────────────
function numFlag(name: string, def: number): number {
  const a = process.argv.find((x) => x.startsWith(name));
  if (!a) return def;
  const raw = a.includes('=') ? a.split('=')[1] : process.argv[process.argv.indexOf(a) + 1];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}
function strFlag(name: string, def: string): string {
  const a = process.argv.find((x) => x.startsWith(name));
  if (!a) return def;
  return a.includes('=') ? a.split('=')[1] : process.argv[process.argv.indexOf(a) + 1] ?? def;
}
const EVAL_MONTHS = numFlag('--eval-months', 6);
const EVAL_LIMIT = numFlag('--limit', 10000);
const TREND_WINDOW_MONTHS = numFlag('--trend-window-mo', 24);
// Shift the eval window back N months for a DISJOINT out-of-sample holdout (default 0 =
// most-recent EVAL_MONTHS). With N=EVAL_MONTHS, eval months [N, N+EVAL_MONTHS) — no
// overlap with the tuning eval — to check the recalibrated bands aren't overfit.
const EVAL_END_MONTHS_AGO = numFlag('--eval-end-months-ago', 0);
const REFRESH_POOL = process.argv.includes('--refresh-pool');
const VARIANT = strFlag('--variant', 'baseline');
const OUT_PATH = strFlag('--out', `avm-exp-${VARIANT}.json`);
const MIN_SALE_PRICE = numFlag('--min-sale-price', DEFAULT_SALE_PRICE_FLOOR);

const MAX_COMPS = 500;
const MIN_TREND_SAMPLES = 8;
const MIN_OFFSET_SAMPLES = 5;
const READ_PAGE = 500; // smaller pages — selecting raw_payload->>PostalCode detoasts JSONB

// ── Variant → tuning map (DEFAULT_TUNING reproduces production exactly) ───────
function buildTuning(variant: string): AvmTuning {
  switch (variant) {
    // The pre-change behaviour (now LEGACY_TUNING; DEFAULT_TUNING is the new prod config).
    case 'baseline':
    case 'legacy':
      return LEGACY_TUNING;
    // The shipped production config.
    case 'prod':
      return DEFAULT_TUNING;
    // Calibration only: predictive predSD (comp dispersion) + recalibrated bands.
    case 'predictive':
      return { ...DEFAULT_TUNING, predMode: 'predictive', bandHigh: 0.12, bandMed: 0.20, bandLow: 0.45, priorSd: 0.22 };
    // Tail only: raise the estimate clamp + route more homes to the peer grid.
    case 'tail':
      return { ...DEFAULT_TUNING, adjClamp: 0.9, peerTrigger: 0.25 };
    // Combined calibration + tail.
    case 'combo':
      return { ...DEFAULT_TUNING, predMode: 'predictive', bandHigh: 0.12, bandMed: 0.20, bandLow: 0.45, priorSd: 0.22, adjClamp: 0.9, peerTrigger: 0.25 };
    // Shrinkage schedule only (predictive bands): weaken the prior as comps accumulate.
    case 'shrink':
      return { ...DEFAULT_TUNING, predMode: 'predictive', bandHigh: 0.12, bandMed: 0.20, bandLow: 0.45, priorSd: 0.22, tau2Schedule: { ltN: 3, lt: 0.02, geN: 15, ge: 0.10 } };
    // combo + shrinkage schedule (the full root-cause stack).
    case 'combo2':
      return { ...DEFAULT_TUNING, predMode: 'predictive', bandHigh: 0.12, bandMed: 0.20, bandLow: 0.45, priorSd: 0.22, adjClamp: 0.9, peerTrigger: 0.25, tau2Schedule: { ltN: 3, lt: 0.02, geN: 15, ge: 0.10 } };
    // combo2 + suppress the known-catastrophic 'floor' basis and exotic property types.
    case 'combo3':
      return { ...DEFAULT_TUNING, predMode: 'predictive', bandHigh: 0.12, bandMed: 0.20, bandLow: 0.45, priorSd: 0.22, adjClamp: 0.9, peerTrigger: 0.25, tau2Schedule: { ltN: 3, lt: 0.02, geN: 15, ge: 0.10 }, suppressFloor: true, suppressExotic: true };
    // Production (DEFAULT) + hierarchical geographic comp weighting. Sweep the strengths.
    case 'geo':
      return { ...DEFAULT_TUNING, geoFull: 4, geoBlock: 2, geoFsa: 1.3 };
    case 'geo_light':
      return { ...DEFAULT_TUNING, geoFull: 2.5, geoBlock: 1.6, geoFsa: 1.2 };
    case 'geo_heavy':
      return { ...DEFAULT_TUNING, geoFull: 6, geoBlock: 2.5, geoFsa: 1.4 };
    case 'geo_xheavy':
      return { ...DEFAULT_TUNING, geoFull: 10, geoBlock: 3.5, geoFsa: 1.6 };
    // geo_heavy weights but comps use the FSA-only scalar column (the live PRE-backfill state).
    case 'geo_fsaonly':
      return { ...DEFAULT_TUNING, geoFull: 6, geoBlock: 2.5, geoFsa: 1.4 };
    default:
      console.warn(`[experiment] unknown variant "${variant}" → DEFAULT_TUNING`);
      return DEFAULT_TUNING;
  }
}
const TUNING = buildTuning(VARIANT);

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface PoolRow {
  listing_key: string;
  close_price: number | null;
  purchase_contract_date: string | null;
  close_date: string | null;
  city: string | null;
  city_region: string | null;
  property_sub_type: string | null;
  postal_code: string | null;
  pcfull: string | null; // full 6-char postal from raw_payload->>PostalCode
  building_area_total: number | null;
  lot_width: number | null;
  lot_depth: number | null;
  bedrooms_above_grade: number | null;
  bedrooms_below_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  interior_tier: number | null;
  exterior_tier: number | null;
  basement_tier: number | null;
}
interface Sale extends PoolRow {
  refDate: string;
  normSub: string;
  period: string;
}
interface ResultRow {
  listing_key: string;
  city: string | null;
  city_region: string | null;
  reference_date: string;
  close_price: number;
  estimated_value: number | null;
  log_error: number | null;
  abs_pct_error: number | null;
  basis: string;
  confidence: string;
  n_eff: number | null;
  comps: number | null;
  in_band: boolean | null;
  predictive_sd: number | null;
  price_tier: string;
  property_sub_type: string | null;
  norm_sub: string;
  sqft_present: boolean;
  lot_present: boolean;
  untrained: boolean;
  borrowed: boolean;
}

const SELECT_COLS =
  'listing_key, close_price, purchase_contract_date, close_date, city, city_region, ' +
  'property_sub_type, postal_code, pcfull:raw_payload->>PostalCode, building_area_total, lot_width, lot_depth, bedrooms_above_grade, bedrooms_below_grade, ' +
  'bathrooms_total_integer, parking_total, interior_tier, exterior_tier, basement_tier';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
function isoMinusMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
function periodStart(periodEnd: string): string {
  const y = periodEnd.slice(0, 4);
  return periodEnd.endsWith('-06-30') ? `${y}-01-01` : `${y}-07-01`;
}
function priceTier(p: number): string {
  if (p < 500_000) return '<500k';
  if (p < 1_000_000) return '500k-1M';
  if (p < 1_500_000) return '1M-1.5M';
  if (p < 2_000_000) return '1.5M-2M';
  return '2M+';
}
function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(2) + '%');

// ─────────────────────────────────────────────────────────────────────────────
// In-memory model resolution (faithful replica of resolveModel + fetch* + sibling)
// ─────────────────────────────────────────────────────────────────────────────
interface AuditInfo { r2: number | null; basePrice: number | null; n: number | null; }
interface MemModel {
  matrixByVerbatim: Map<string, CoefficientRow[]>; // `${city_region}||${normSub}` (verbatim spelling) → coeffs
  snapshotMatrix: Map<string, Matrix>;             // candidate-expanded → FeatureCoeff map (for snapshot adjust)
  auditByVerbatim: Map<string, AuditInfo>;         // `${city_region}||${normSub}` → audit
  cityRegionsByCity: Map<string, Set<string>>;     // `${cityLower}||${normSub}` → set of city_region
}

async function loadMatrix(): Promise<{ matrixByVerbatim: Map<string, CoefficientRow[]>; snapshotMatrix: Map<string, Matrix> }> {
  const matrixByVerbatim = new Map<string, CoefficientRow[]>();
  const snapshotMatrix = new Map<string, Matrix>();
  const byVerbatimSnap = new Map<string, Matrix>();
  let cursor = 0;
  for (;;) {
    const { data, error } = await sb
      // Pinned to the community rung. Migration 130 lets a cohort be keyed on a postal FSA
      // or a whole city as well, and 67 city names collide with an existing city_region
      // spelling — without this filter a city cohort's rows would silently mix into a
      // community cohort's feature set. The ladder is opted into deliberately, not inherited.
      .from('avm_multiplier_matrix')
      .select('id, city_region, property_sub_type, feature_name, beta, feat_mean, feat_std')
      .eq('cohort_rung', 'community')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(READ_PAGE);
    if (error) throw new Error(`matrix load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: number; city_region: string; property_sub_type: string; feature_name: string; beta: number; feat_mean: number; feat_std: number }>) {
      const sub = normalizePropertySubType(r.property_sub_type);
      const vKey = `${r.city_region}||${sub}`;
      // routing coefficients (verbatim, like fetchCoefficients before candidate pick)
      let cr = matrixByVerbatim.get(vKey);
      if (!cr) { cr = []; matrixByVerbatim.set(vKey, cr); }
      cr.push({ featureName: r.feature_name, beta: r.beta, mean: r.feat_mean, std: r.feat_std });
      // snapshot Matrix (candidate-expanded, like loadMatricesForSnapshot)
      let m = byVerbatimSnap.get(vKey);
      if (!m) {
        m = new Map();
        byVerbatimSnap.set(vKey, m);
        for (const cand of cityRegionLookupCandidates(r.city_region)) {
          const candKey = `${cand}||${sub}`;
          if (!snapshotMatrix.has(candKey)) snapshotMatrix.set(candKey, m);
        }
      }
      m.set(r.feature_name, { beta: r.beta, mean: r.feat_mean, std: r.feat_std });
      cursor = r.id;
    }
    if (data.length < READ_PAGE) break;
  }
  return { matrixByVerbatim, snapshotMatrix };
}

async function loadAudit(): Promise<Map<string, AuditInfo>> {
  const audit = new Map<string, AuditInfo>();
  let cursor = 0;
  for (;;) {
    const { data, error } = await sb
      .from('avm_audit_report')
      .select('id, city_region, property_sub_type, model_accuracy_score, average_error_margin, total_sales_analyzed, base_price')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(READ_PAGE);
    if (error) throw new Error(`audit load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: number; city_region: string; property_sub_type: string; model_accuracy_score: number | null; total_sales_analyzed: number | null; base_price: number | null }>) {
      const sub = normalizePropertySubType(r.property_sub_type);
      audit.set(`${r.city_region}||${sub}`, { r2: r.model_accuracy_score, basePrice: r.base_price, n: r.total_sales_analyzed });
      cursor = r.id;
    }
    if (data.length < READ_PAGE) break;
  }
  return audit;
}

/** Candidate-priority lookup over a verbatim-keyed map — mirrors fetchCoefficients/fetchAuditInfo. */
function lookupByCandidate<T>(map: Map<string, T>, cityRegion: string, normSub: string): T | null {
  for (const cand of cityRegionLookupCandidates(cityRegion)) {
    const v = map.get(`${cand}||${normSub}`);
    if (v !== undefined) return v;
  }
  return null;
}

interface Resolved {
  nativeCoefficients: CoefficientRow[];
  effectiveCoefficients: CoefficientRow[];
  r2: number | null;
  basePrice: number | null;
  n: number | null;
  borrowed: boolean;
}
function resolveModelMem(mem: MemModel, input: AVMInput): Resolved {
  const native = lookupByCandidate(mem.matrixByVerbatim, input.cityRegion, input.propertySubType) ?? [];
  const audit = lookupByCandidate(mem.auditByVerbatim, input.cityRegion, input.propertySubType);
  if (native.length === 0) {
    // sibling borrow
    const city = (input.city ?? '').trim().toLowerCase();
    const set = city ? mem.cityRegionsByCity.get(`${city}||${input.propertySubType}`) : undefined;
    if (set && set.size > 0) {
      const auditRows = [...set]
        .map((cr) => {
          const a = lookupByCandidate(mem.auditByVerbatim, cr, input.propertySubType);
          return a ? { city_region: cr, model_accuracy_score: a.r2, total_sales_analyzed: a.n } : null;
        })
        .filter((x): x is { city_region: string; model_accuracy_score: number | null; total_sales_analyzed: number | null } => x !== null);
      const best = pickSibling(auditRows);
      if (best) {
        const sibCoeffs = lookupByCandidate(mem.matrixByVerbatim, best.city_region, input.propertySubType) ?? [];
        if (sibCoeffs.length > 0) {
          return { nativeCoefficients: [], effectiveCoefficients: sibCoeffs, r2: best.r2, basePrice: audit?.basePrice ?? null, n: best.n, borrowed: true };
        }
      }
    }
  }
  return {
    nativeCoefficients: native,
    effectiveCoefficients: native,
    r2: audit?.r2 ?? null,
    basePrice: audit?.basePrice ?? null,
    n: audit?.n ?? null,
    borrowed: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot + comps (identical methodology to avm-backtest.ts)
// ─────────────────────────────────────────────────────────────────────────────
interface Snapshot { trendRows: AggTrendRow[]; offsetRows: AggOffsetRow[]; }
function buildSnapshot(pool: Sale[], snapMatrix: Map<string, Matrix>, windowStartIso: string, cutoffExclusiveIso: string | null): Snapshot {
  const records: LRecord[] = [];
  for (const s of pool) {
    if (s.refDate < windowStartIso) continue;
    if (cutoffExclusiveIso !== null && s.refDate >= cutoffExclusiveIso) continue;
    const city = (s.city || '').trim();
    const cityRegion = (s.city_region || '').trim();
    if (!city || !cityRegion || !s.normSub) continue;
    const m = snapMatrix.get(`${cityRegion}||${s.normSub}`);
    if (!m) continue;
    const l = adjustedLogPriceForAgg(s, m);
    if (l === null) continue;
    records.push({ city, cityRegion, subType: s.normSub, periodEnd: s.period, l });
  }
  const { trendRows, offsetRows } = aggregateTrendAndOffset(records, { minTrendSamples: MIN_TREND_SAMPLES, minOffsetSamples: MIN_OFFSET_SAMPLES });
  return { trendRows, offsetRows };
}
function toCompRow(c: Sale): CompRow {
  return {
    close_price: c.close_price as number,
    purchase_contract_date: c.purchase_contract_date,
    close_date: c.close_date,
    building_area_total: c.building_area_total,
    lot_width: c.lot_width,
    lot_depth: c.lot_depth,
    bedrooms_above_grade: c.bedrooms_above_grade,
    bedrooms_below_grade: c.bedrooms_below_grade,
    bathrooms_total_integer: c.bathrooms_total_integer,
    parking_total: c.parking_total,
    interior_tier: c.interior_tier,
    exterior_tier: c.exterior_tier,
    basement_tier: c.basement_tier,
    // full payload postal for geo weighting; geo_fsaonly mimics the live pre-backfill
    // state where the comp postal column is still FSA-truncated.
    postal_code: VARIANT === 'geo_fsaonly' ? c.postal_code : c.pcfull,
  };
}
function inputFromSale(s: Sale): AVMInput {
  return {
    cityRegion: (s.city_region || '').trim(),
    city: (s.city || '').trim() || null,
    propertySubType: s.normSub,
    rawPropertySubType: (s.property_sub_type || '').trim(),
    buildingAreaTotal: s.building_area_total !== null && s.building_area_total > 0 ? s.building_area_total : null,
    lotWidth: s.lot_width !== null && s.lot_width > 0 ? s.lot_width : null,
    lotDepth: s.lot_depth !== null && s.lot_depth > 0 ? s.lot_depth : null,
    bedroomsAboveGrade: s.bedrooms_above_grade,
    bedroomsBelowGrade: s.bedrooms_below_grade,
    bathroomsTotalInteger: s.bathrooms_total_integer,
    parkingTotal: s.parking_total,
    interiorTier: s.interior_tier ?? NEUTRAL_TIER,
    exteriorTier: s.exterior_tier ?? NEUTRAL_TIER,
    basementTier: s.basement_tier ?? BASEMENT_NONE_TIER,
    postalCode: s.pcfull,
  };
}
function compsFor(pool: Sale[], pred: (c: Sale) => boolean, limit: number): CompRow[] {
  return pool.filter(pred).sort((a, b) => (a.refDate < b.refDate ? 1 : a.refDate > b.refDate ? -1 : 0)).slice(0, limit).map(toCompRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// Replay one sale (mirror of avm-backtest.replaySale; in-memory resolve)
// ─────────────────────────────────────────────────────────────────────────────
function replaySale(s: Sale, pool: Sale[], snapshot: Snapshot, mem: MemModel): ResultRow | null {
  const cityRegion = (s.city_region || '').trim();
  if (!cityRegion || !s.normSub || !s.close_price) return null;
  const input = inputFromSale(s);
  const { nativeCoefficients, effectiveCoefficients, r2, basePrice, n, borrowed } = resolveModelMem(mem, input);
  const untrained = nativeCoefficients.length === 0;

  const cityKey = input.city ?? input.cityRegion;
  const trend = selectTrendSeries(snapshot.trendRows, cityKey, input.propertySubType) as TrendRow[];
  const offsets = selectOffsets(snapshot.offsetRows, cityRegionLookupCandidates(cityRegion), input.propertySubType) as OffsetRow[];

  const compWindowStart = isoMinusMonths(s.refDate, COMP_WINDOW_MO);
  const candSet = new Set(cityRegionLookupCandidates(cityRegion));
  const subVariants = new Set(rawVariantsOf(input.propertySubType, input.rawPropertySubType));
  const community = compsFor(
    pool,
    (c) => c.listing_key !== s.listing_key && c.refDate < s.refDate && c.refDate >= compWindowStart &&
      c.city_region !== null && candSet.has(c.city_region.trim()) &&
      c.property_sub_type !== null && subVariants.has(c.property_sub_type) && c.close_price !== null && c.close_price > 0,
    MAX_COMPS,
  );
  const nowMs = Date.parse(s.refDate + 'T00:00:00Z');

  const anchor = computeAnchorFromData(input, effectiveCoefficients, basePrice, { comps: community, trend, offsets, nowMs }, TUNING);

  let peer: AnchorResult | null | undefined;
  if (shouldEvaluatePeers(input, nativeCoefficients, TUNING)) {
    const subjCity = (input.city ?? '').trim().toLowerCase();
    const cityWide = subjCity
      ? compsFor(
          pool,
          (c) => c.listing_key !== s.listing_key && c.refDate < s.refDate && c.refDate >= compWindowStart &&
            (c.city || '').trim().toLowerCase() === subjCity &&
            c.property_sub_type !== null && subVariants.has(c.property_sub_type) && c.close_price !== null && c.close_price > 0,
          MAX_COMPS,
        )
      : [];
    const cityRegionCandCount = candSet.size;
    const cityKey2 = (input.city ?? input.cityRegion).trim();
    if (cityRegionCandCount === 0 && !cityKey2) peer = undefined;
    else {
      peer = null;
      if (cityRegionCandCount > 0) {
        const p = peerLevelFromComps(input, community, effectiveCoefficients, trend, nowMs, 'peer', TUNING);
        if (p && p.nEff >= MIN_PEER_NEFF) peer = p;
      }
      if (!peer && cityKey2) {
        const p = peerLevelFromComps(input, cityWide, effectiveCoefficients, trend, nowMs, 'peer', TUNING);
        if (p && p.nEff >= MIN_PEER_NEFF) peer = p;
      }
    }
    if (peer && borrowed) peer.basis = 'borrowed';
  }

  const result: AVMResult = estimateFromMarketData(input, { anchor, r2, basePrice, coefficients: nativeCoefficients, n, peer }, TUNING);

  const close = s.close_price;
  const est = result.estimatedValue > 0 ? result.estimatedValue : null;
  const logErr = est !== null ? Math.log(est) - Math.log(close) : null;
  const absPct = est !== null ? Math.abs(est - close) / close : null;
  const inBand = est !== null && result.lowBand > 0 && result.highBand > 0 ? close >= result.lowBand && close <= result.highBand : null;

  return {
    listing_key: s.listing_key, city: input.city, city_region: cityRegion, reference_date: s.refDate,
    close_price: close, estimated_value: est, log_error: logErr, abs_pct_error: absPct,
    basis: result.basis, confidence: result.confidence, n_eff: result.nEff, comps: result.comps, in_band: inBand,
    predictive_sd: Number.isFinite(result.predictiveSD) ? result.predictiveSD : null,
    price_tier: priceTier(close), property_sub_type: s.property_sub_type, norm_sub: s.normSub,
    sqft_present: s.building_area_total !== null && s.building_area_total > 0,
    lot_present: s.lot_width !== null && s.lot_width > 0,
    untrained, borrowed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report (inline summary; full slicing via avm-bt-analyze.ts on the JSON)
// ─────────────────────────────────────────────────────────────────────────────
function report(rows: ResultRow[]) {
  const est = rows.filter((r) => r.abs_pct_error !== null);
  const abs = est.map((r) => r.abs_pct_error as number);
  const logs = est.map((r) => r.log_error as number);
  console.log('\n──────── OVERALL ────────');
  console.log(`Sales evaluated:   ${rows.length}  (published: ${est.length}, suppressed: ${rows.length - est.length})`);
  console.log(`Median |%err|:     ${pct(median(abs))}`);
  console.log(`Mean   |%err|:     ${pct(mean(abs))}`);
  console.log(`Bias (mean ln-err):${' ' + mean(logs).toFixed(4)}`);
  console.log(`Hit ±10% / ±20%:   ${pct(est.filter((r) => (r.abs_pct_error as number) <= 0.1).length / est.length)} / ${pct(est.filter((r) => (r.abs_pct_error as number) <= 0.2).length / est.length)}`);
  console.log(`Band coverage:     ${pct(est.filter((r) => r.in_band === true).length / est.length)}  (ideal ≈ 68.2%)`);
  const tiers = ['<500k', '500k-1M', '1M-1.5M', '1.5M-2M', '2M+'];
  console.log('\nBy price tier (median, mean, bias, n):');
  for (const t of tiers) {
    const sub = est.filter((r) => r.price_tier === t);
    if (!sub.length) { console.log(`   ${t.padEnd(10)} n=0`); continue; }
    const a = sub.map((r) => r.abs_pct_error as number);
    const b = mean(sub.map((r) => r.log_error as number));
    console.log(`   ${t.padEnd(10)} ${pct(median(a)).padStart(7)}  mean ${pct(mean(a)).padStart(7)}  bias ${((b >= 0 ? '+' : '') + (b * 100).toFixed(2) + '%').padStart(8)}  n=${sub.length}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log(`  AVM FAST EXPERIMENT  variant=${VARIANT}`);
  console.log(`  eval: last ${EVAL_MONTHS} mo · trend: ${TREND_WINDOW_MONTHS} mo · comp: ${COMP_WINDOW_MO} mo · limit: ${EVAL_LIMIT}`);
  console.log('========================================');

  console.log('Loading matrix + audit…');
  const [{ matrixByVerbatim, snapshotMatrix }, auditByVerbatim] = await Promise.all([loadMatrix(), loadAudit()]);
  console.log(`   matrix cohorts: ${matrixByVerbatim.size}  ·  audit cohorts: ${auditByVerbatim.size}  ·  snapshot keys: ${snapshotMatrix.size}`);

  const poolWindowStart = monthsAgoIso(EVAL_END_MONTHS_AGO + EVAL_MONTHS + TREND_WINDOW_MONTHS + 1);
  // Pool is identical across variants (same window) — cache it locally so the heavy
  // JSONB-postal stream runs ONCE, then every tuning variant reuses it. --refresh-pool forces.
  const POOL_CACHE = `.pool-cache-${poolWindowStart}.json`;
  let pool: Sale[];
  if (!REFRESH_POOL && fs.existsSync(POOL_CACHE)) {
    pool = JSON.parse(fs.readFileSync(POOL_CACHE, 'utf8')) as Sale[];
    console.log(`Loaded pool from cache ${POOL_CACHE}: ${pool.length} rows`);
  } else {
    console.log(`Streaming raw_vow_sold (purchase_contract_date >= ${poolWindowStart})…`);
    pool = [];
    let cursor = '';
    for (;;) {
      const { data, error } = await sb
        .from('raw_vow_sold')
        .select(SELECT_COLS)
        .gt('listing_key', cursor)
        .gte('purchase_contract_date', poolWindowStart)
        .eq('transaction_type', SALE_TRANSACTION_TYPE)
        .gte('close_price', MIN_SALE_PRICE)
        .order('listing_key', { ascending: true })
        .limit(READ_PAGE);
      if (error) { console.error('pool read error:', error.message, '— retry'); await sleep(2000); continue; }
      if (!data || data.length === 0) break;
      for (const r of data as unknown as PoolRow[]) {
        cursor = r.listing_key;
        const refDate = (r.purchase_contract_date || r.close_date || '').slice(0, 10);
        if (!refDate) continue;
        pool.push({ ...r, refDate, normSub: normalizePropertySubType(r.property_sub_type), period: periodEndForDate(refDate) });
      }
      if (data.length < READ_PAGE) break;
      await sleep(40);
    }
    fs.writeFileSync(POOL_CACHE, JSON.stringify(pool));
    console.log(`   pool size: ${pool.length} (cached → ${POOL_CACHE})`);
  }

  // Build city→communities index for in-memory sibling resolution.
  const cityRegionsByCity = new Map<string, Set<string>>();
  for (const s of pool) {
    const city = (s.city || '').trim().toLowerCase();
    const cr = (s.city_region || '').trim();
    if (!city || !cr || !s.normSub) continue;
    const key = `${city}||${s.normSub}`;
    let set = cityRegionsByCity.get(key);
    if (!set) { set = new Set(); cityRegionsByCity.set(key, set); }
    set.add(cr);
  }
  const mem: MemModel = { matrixByVerbatim, snapshotMatrix, auditByVerbatim, cityRegionsByCity };

  const evalWindowEnd = monthsAgoIso(EVAL_END_MONTHS_AGO);
  const evalWindowStart = monthsAgoIso(EVAL_END_MONTHS_AGO + EVAL_MONTHS);
  let evalSales = pool
    .filter((s) => s.refDate >= evalWindowStart && s.refDate < evalWindowEnd && s.normSub && (s.city_region || '').trim())
    .sort((a, b) => (a.refDate < b.refDate ? 1 : a.refDate > b.refDate ? -1 : 0));
  if (Number.isFinite(EVAL_LIMIT)) evalSales = evalSales.slice(0, EVAL_LIMIT);
  console.log(`\nEvaluating ${evalSales.length} held-out sales (in-memory resolve)…`);

  const snapshotCache = new Map<string, Snapshot>();
  const snapshotFor = (period: string): Snapshot => {
    let snap = snapshotCache.get(period);
    if (!snap) {
      const pStart = periodStart(period);
      snap = buildSnapshot(pool, snapshotMatrix, isoMinusMonths(pStart, TREND_WINDOW_MONTHS), pStart);
      snapshotCache.set(period, snap);
    }
    return snap;
  };

  const results: ResultRow[] = [];
  let done = 0;
  for (const s of evalSales) {
    const row = replaySale(s, pool, snapshotFor(s.period), mem);
    if (row) results.push(row);
    if (++done % 2000 === 0) console.log(`   …replayed ${done}/${evalSales.length}`);
  }

  report(results);
  const summary = { variant: VARIANT, generated_at_note: 'local', params: { evalMonths: EVAL_MONTHS, trendWindowMo: TREND_WINDOW_MONTHS, compWindowMo: COMP_WINDOW_MO, limit: EVAL_LIMIT }, n: results.length, results };
  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${results.length} rows to ${OUT_PATH}`);
}

main().catch((e) => { console.error('CRASH:', e?.message || e); process.exit(1); });
