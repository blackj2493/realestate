/**
 * Branch-faithful, leakage-safe AVM out-of-time backtest (branch feat/avm-untrained-cohort).
 *
 * Replays THIS BRANCH's request-time AVM against held-out raw_vow_sold sales and
 * compares the estimate to the actual ClosePrice. Unlike the original harness (which
 * predates the untrained-cohort fix), this one reproduces the FULL routing this branch
 * ships: borrowed-sibling models for untrained cohorts (resolveModel/fetchSiblingModel),
 * the peer comp-grid (peerLevelFromComps), and the size/bed/bath escalation — by calling
 * the SAME pure functions the live path calls (computeAnchorFromData + peerLevelFromComps
 * + estimateFromMarketData). It measures the model AS DEPLOYED, not a reimplementation.
 *
 * LEAKAGE IS THE CORE DISCIPLINE (only data dated < t_S may inform an estimate):
 *   - Reference date = purchase_contract_date (deal signing), never close_date.
 *   - Comps: purchase_contract_date < t_S, within COMP_WINDOW_MO, EXCLUDING S, floored
 *     at MIN_SALE_PRICE (lease exclusion — see types.MIN_SALE_PRICE).
 *   - Trend/offset: an AS-OF snapshot aggregated (via the shared trendOffset core) from
 *     sales whose half-year period ended strictly before t_S's period — what production
 *     would have computed at the start of t_S's period. NEVER the live future-laden
 *     avm_trend_index / avm_community_offset tables.
 *   - resolveModel (coefficients / audit R² / sibling) IS live: these are STATIC offline
 *     artifacts (the matrix/audit are retrained out-of-band), so reading them is
 *     leakage-safe in the same sense the original harness used the static matrix.
 *   - --leaky feeds a snapshot built from ALL sales (incl. AFTER t_S). It MUST score
 *     materially better; if it doesn't, leakage isn't actually prevented.
 *
 * KEY DELIVERABLE — the untrained-cohort subset (this branch's whole point):
 *   For sales whose NATIVE cohort is untrained (no avm_multiplier_matrix row), the harness
 *   scores BOTH on the SAME leakage-safe comps:
 *     OLD = computeAnchorFromData(comps, trend, offset, [] (empty coeffs), basePrice) ->
 *           anchor-only, no peer routing  (the pre-fix behaviour: blind cohort average)
 *     NEW = full this-branch routing (borrowed model + peer comp-grid)
 *   and reports median/mean |%err| OLD vs NEW, bias, % improved, and the NEW confidence
 *   distribution (must contain 0 HIGH). This is the clean leakage-safe analog of the
 *   earlier live result (11.9% → 10.3%).
 *
 * FIDELITY CHECK (--fidelity): with a NOW-dated window (no leakage filter), the harness's
 * estimate must match LIVE calculateAVM for a basket of listing keys (Aurora N13229524 +
 * others). If they diverge, the routing replication is wrong — fix before trusting numbers.
 *
 * 100% deterministic, no AI (CLAUDE.md §4). raw_vow_sold is READ-ONLY (§12). This script
 * writes NOTHING to the database — results go to a local JSON file (--out). IO-frugal:
 * scalar columns only, keyset pagination, bounded window, retry/backoff.
 *
 * Usage (run where .env with Supabase creds lives):
 *   npx.cmd tsx --env-file=.env scripts/admin/avm-backtest.ts --limit 10000 --eval-months 6
 *   npx.cmd tsx --env-file=.env scripts/admin/avm-backtest.ts --leaky --limit 10000   # self-test
 *   npx.cmd tsx --env-file=.env scripts/admin/avm-backtest.ts --fidelity              # live-match check
 */

// Proper TLS verification — Supabase serves valid certs; no weakening needed.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import {
  normalizePropertySubType,
  cityRegionLookupCandidates,
  rawVariantsOf,
  fsaOf,
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
import {
  estimateFromMarketData,
  shouldEvaluatePeers,
  resolveModel,
  calculateAVM,
  marketDataOf,
} from '@/lib/avm/calculator';
import type { CoefficientRow } from '@/lib/avm/matrixService';
import type { AVMInput, AVMResult } from '@/lib/avm/types';
import { COMP_WINDOW_MO, SALE_TRANSACTION_TYPE, MIN_CLOSE_PRICE as DEFAULT_CLOSE_PRICE_FLOOR, MIN_PEER_NEFF } from '@/lib/avm/types';
import { NEUTRAL_TIER, BASEMENT_NONE_TIER } from '@/lib/avm/conditionScoring';
import { mapListingToAVMInput } from '@/lib/avm/mapListingToAVMInput';
import { computeDealScore } from '@/lib/dealScore/computeDealScore';
import { resolveLivingArea, calibrationRegionKey, type BucketCalibration } from '@/lib/avm/livingArea';
import type { RoomData } from '@/lib/room-utils';

// ── CLI flags ────────────────────────────────────────────────────────────────
const LEAKY = process.argv.includes('--leaky');
const FIDELITY = process.argv.includes('--fidelity');
// --fsa: evaluate ONLY sales whose feed carries no CityRegion (Waterloo Region,
// Brantford). These were invisible to every previous run — the eval filter below
// requires a non-blank city_region — so the FSA-cohort path has no baseline. For each
// sale the replay scores BOTH the FSA-cohort estimate (the shipped path) AND a
// city-wide-pool alternative on the same leakage-safe data, so the PR can say with
// numbers whether neighbourhood-scale comps actually earn their tighter band.
const FSA_MODE = process.argv.includes('--fsa');
// --dealscore: grade each held-out sale with the Deal Score a buyer would have seen just
// before it sold (final list price, cumulative cut, final DOM, leakage-safe as-of AVM —
// Homebuyer lens) and report the REALIZED outcome per grade: close/list, close vs as-of
// value, DOM, % over ask. This is the track-record backtest computeDealScore's header
// defers — the evidence gate before ever touching PERSONA_WEIGHTS. Two caveats are
// carried in the report itself: survivorship (only sales are here, so grade→sell-through
// is not measurable) and the mechanical TERMS↔close/list correlation (cuts and DOM sit
// on both sides), which is why outcomes are ALSO stratified by the price-vs-value band
// alone — the PRICE pillar's raw input, free of that circularity.
const DEALSCORE_MODE = process.argv.includes('--dealscore');
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
const EVAL_LIMIT = numFlag('--limit', Infinity);
const TREND_WINDOW_MONTHS = numFlag('--trend-window-mo', 24);
const RUN_ID = strFlag('--run-id', `branch-eval${EVAL_MONTHS}m${LEAKY ? '-leaky' : ''}`);
const OUT_PATH = strFlag('--out', `avm-backtest-${RUN_ID}.json`);
// Leases are excluded by transaction_type, matching production exactly — a pool
// filtered differently would score the model on a population production never sees.
const MIN_SALE_PRICE = numFlag('--min-sale-price', DEFAULT_CLOSE_PRICE_FLOOR);
// --cities: restrict the POOL fetch to a comma-separated city list. Safe whenever the
// eval set lives inside the list — comps and trend are both same-city constructs — and
// it turns a ~289k-row stream into a few thousand. Intended for --fsa runs (the
// blank-CityRegion population is 8 municipalities); leave unset for the global baseline.
const CITIES = strFlag('--cities', '').split(',').map((c) => c.trim()).filter(Boolean);

// ── statistical thresholds (match the live anchor / refresh job) ──────────────
const MAX_COMPS = 500;
const MIN_TREND_SAMPLES = 8;
const MIN_OFFSET_SAMPLES = 5;

// ── IO pacing ─────────────────────────────────────────────────────────────────
const READ_PAGE = 1000;
const INTER_CHUNK_DELAY_MS = 250;
const MAX_READ_RETRIES = 5;

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
// Domain types
// ─────────────────────────────────────────────────────────────────────────────
interface PoolRow {
  listing_key: string;
  close_price: number | null;
  purchase_contract_date: string | null;
  close_date: string | null;
  city: string | null;
  city_region: string | null;
  property_sub_type: string | null;
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
  postal_code: string | null;
  list_price: number | null;
  original_list_price: number | null;
  days_on_market: number | null;
}

interface Sale extends PoolRow {
  refDate: string; // YYYY-MM-DD (purchase_contract_date)
  normSub: string; // normalizePropertySubType(property_sub_type)
  period: string; // periodEndForDate(refDate)
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
  price_tier: string;
  property_sub_type: string | null;
  norm_sub: string;
  sqft_present: boolean;
  lot_present: boolean;
  untrained: boolean;
  borrowed: boolean;
  // Untrained OLD-vs-NEW (only populated for untrained cohorts):
  old_estimated_value: number | null;
  old_abs_pct_error: number | null;
  old_log_error: number | null;
  // --dealscore mode only: the as-of Homebuyer grade and the realized outcome.
  deal_grade: string | null;
  deal_score: number | null;
  close_list_ratio: number | null;
  close_avm_ratio: number | null;
  list_avm_ratio: number | null;
  dom_days: number | null;
}

// postal_code added 2026-08: the FSA cohort groups on it, and comps carrying it also
// activate the hierarchical geo weighting live comps always had — the harness was
// silently replaying with geo weights off (CompRow.postal_code optional, never
// supplied), a small fidelity gap in every prior run.
const SELECT_COLS =
  'listing_key, close_price, purchase_contract_date, close_date, city, city_region, ' +
  'property_sub_type, building_area_total, lot_width, lot_depth, bedrooms_above_grade, bedrooms_below_grade, ' +
  'bathrooms_total_integer, parking_total, interior_tier, exterior_tier, basement_tier, ' +
  // list_price + original_list_price + days_on_market: the pre-sale state for
  // --dealscore (100% populated on For Sale closes; flat columns, no TOAST).
  'postal_code, list_price, original_list_price, days_on_market';

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers — ISO 'YYYY-MM-DD' compares lexicographically = chronologically.
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

// ─────────────────────────────────────────────────────────────────────────────
// Matrix preload — ONLY to build the as-of trend/offset snapshot (feature-adjust
// each sold ℓ_i). Subject routing uses live resolveModel, not this. Mirrors the
// refresh job's candidate-expanded keying so a sold row's CityRegion hits its cohort.
// ─────────────────────────────────────────────────────────────────────────────
async function loadMatricesForSnapshot(): Promise<Map<string, Matrix>> {
  const expanded = new Map<string, Matrix>();
  const byVerbatim = new Map<string, Matrix>();
  let cursor = 0;
  for (;;) {
    const { data, error } = await sb
      // Champion/challenger: same allowlist as matrixService so the whole backtest pipeline
      // (subject routing via resolveModel AND this trend/offset snapshot) scores one model.
      .from(process.env.AVM_MATRIX_TABLE === 'avm_multiplier_matrix_staging' ? 'avm_multiplier_matrix_staging' : 'avm_multiplier_matrix')
      .select('id, city_region, property_sub_type, feature_name, beta, feat_mean, feat_std')
      // Pinned to the community rung. Migration 130 lets a cohort be keyed on a postal FSA
      // or a whole city as well, and 67 city names collide with an existing city_region
      // spelling — without this filter a city cohort's rows would silently mix into a
      // community cohort's feature set. The ladder is opted into deliberately, not inherited.
      .eq('cohort_rung', 'community')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(READ_PAGE);
    if (error) throw new Error(`matrix load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{
      id: number;
      city_region: string;
      property_sub_type: string;
      feature_name: string;
      beta: number;
      feat_mean: number;
      feat_std: number;
    }>) {
      const sub = normalizePropertySubType(r.property_sub_type);
      const verbatimKey = `${r.city_region}||${sub}`;
      let m = byVerbatim.get(verbatimKey);
      if (!m) {
        m = new Map();
        byVerbatim.set(verbatimKey, m);
        for (const cand of cityRegionLookupCandidates(r.city_region)) {
          const candKey = `${cand}||${sub}`;
          if (!expanded.has(candKey)) expanded.set(candKey, m);
        }
      }
      m.set(r.feature_name, { beta: r.beta, mean: r.feat_mean, std: r.feat_std });
      cursor = r.id;
    }
    if (data.length < READ_PAGE) break;
  }
  return expanded;
}

// ─────────────────────────────────────────────────────────────────────────────
// raw_vow_sold streaming read (keyset on listing_key, retry/backoff)
// ─────────────────────────────────────────────────────────────────────────────
async function readPoolPage(cursor: string, windowStartIso: string): Promise<PoolRow[] | null> {
  let attempt = 0;
  for (;;) {
    let q = sb
      .from('raw_vow_sold')
      .select(SELECT_COLS)
      .gt('listing_key', cursor)
      .gte('purchase_contract_date', windowStartIso)
      .eq('transaction_type', SALE_TRANSACTION_TYPE)
      .gte('close_price', MIN_SALE_PRICE);
    if (CITIES.length > 0) q = q.in('city', CITIES);
    const { data, error } = await q.order('listing_key', { ascending: true }).limit(READ_PAGE);
    if (!error) return data as unknown as PoolRow[] | null;
    attempt++;
    if (attempt > MAX_READ_RETRIES) {
      throw new Error(`read failed at cursor "${cursor}" after ${MAX_READ_RETRIES} retries: ${error.message}`);
    }
    const backoff = Math.min(30000, 3000 * 2 ** (attempt - 1));
    console.warn(`   read error at "${cursor}" (${attempt}/${MAX_READ_RETRIES}): ${error.message} — backoff ${backoff}ms`);
    await sleep(backoff);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// As-of trend/offset snapshot (shared aggregation core; window-agnostic = leak-safe)
// ─────────────────────────────────────────────────────────────────────────────
interface Snapshot {
  trendRows: AggTrendRow[];
  offsetRows: AggOffsetRow[];
}
function buildSnapshot(
  pool: Sale[],
  expanded: Map<string, Matrix>,
  windowStartIso: string,
  cutoffExclusiveIso: string | null
): Snapshot {
  const records: LRecord[] = [];
  for (const s of pool) {
    if (s.refDate < windowStartIso) continue;
    if (cutoffExclusiveIso !== null && s.refDate >= cutoffExclusiveIso) continue;
    const city = (s.city || '').trim();
    const cityRegion = (s.city_region || '').trim();
    if (!city || !cityRegion || !s.normSub) continue;
    const m = expanded.get(`${cityRegion}||${s.normSub}`);
    if (!m) continue;
    const l = adjustedLogPriceForAgg(s, m);
    if (l === null) continue;
    records.push({ city, cityRegion, subType: s.normSub, periodEnd: s.period, l });
  }
  const { trendRows, offsetRows } = aggregateTrendAndOffset(records, {
    minTrendSamples: MIN_TREND_SAMPLES,
    minOffsetSamples: MIN_OFFSET_SAMPLES,
  });
  return { trendRows, offsetRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function pct(x: number | null): string {
  return x === null || Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(2) + '%';
}

// ─────────────────────────────────────────────────────────────────────────────
// Comp/peer assembly for one held-out sale (leakage-safe: every comp dated < t_S)
// ─────────────────────────────────────────────────────────────────────────────
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
    postal_code: c.postal_code,
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
    postalCode: (s.postal_code || '').trim() || null,
  };
}

/** Community-rung comps (city_region candidates), dated < cutoff, excluding S. */
function communityComps(input: AVMInput, s: Sale, pool: Sale[], cutoffIso: string, windowStartIso: string): CompRow[] {
  const candSet = new Set(cityRegionLookupCandidates(input.cityRegion));
  const subVariants = new Set(rawVariantsOf(input.propertySubType, input.rawPropertySubType));
  return pool
    .filter(
      (c) =>
        c.listing_key !== s.listing_key &&
        c.refDate < cutoffIso &&
        c.refDate >= windowStartIso &&
        c.city_region !== null &&
        candSet.has(c.city_region.trim()) &&
        c.property_sub_type !== null &&
        subVariants.has(c.property_sub_type) &&
        c.close_price !== null &&
        c.close_price > 0
    )
    .sort((a, b) => (a.refDate < b.refDate ? 1 : a.refDate > b.refDate ? -1 : 0))
    .slice(0, MAX_COMPS)
    .map(toCompRow);
}

/** City-wide-rung comps (same municipality), dated < cutoff, excluding S. */
function cityComps(input: AVMInput, s: Sale, pool: Sale[], cutoffIso: string, windowStartIso: string): CompRow[] {
  const subjCity = (input.city ?? '').trim().toLowerCase();
  if (!subjCity) return [];
  const subVariants = new Set(rawVariantsOf(input.propertySubType, input.rawPropertySubType));
  return pool
    .filter(
      (c) =>
        c.listing_key !== s.listing_key &&
        c.refDate < cutoffIso &&
        c.refDate >= windowStartIso &&
        (c.city || '').trim().toLowerCase() === subjCity &&
        c.property_sub_type !== null &&
        subVariants.has(c.property_sub_type) &&
        c.close_price !== null &&
        c.close_price > 0
    )
    .sort((a, b) => (a.refDate < b.refDate ? 1 : a.refDate > b.refDate ? -1 : 0))
    .slice(0, MAX_COMPS)
    .map(toCompRow);
}

/** FSA-rung comps (same postal FSA + same municipality), dated < cutoff, excluding S.
 *  Mirrors sold_fsa_comps (migration 112): the city co-filter is load-bearing for rural
 *  FSAs (N0B spans several townships), a no-op for urban ones. */
function fsaComps(input: AVMInput, s: Sale, pool: Sale[], cutoffIso: string, windowStartIso: string): CompRow[] {
  const fsa = fsaOf(input.postalCode);
  const subjCity = (input.city ?? '').trim().toLowerCase();
  if (!fsa || !subjCity) return [];
  const subVariants = new Set(rawVariantsOf(input.propertySubType, input.rawPropertySubType));
  return pool
    .filter(
      (c) =>
        c.listing_key !== s.listing_key &&
        c.refDate < cutoffIso &&
        c.refDate >= windowStartIso &&
        fsaOf(c.postal_code) === fsa &&
        (c.city || '').trim().toLowerCase() === subjCity &&
        c.property_sub_type !== null &&
        subVariants.has(c.property_sub_type) &&
        c.close_price !== null &&
        c.close_price > 0
    )
    .sort((a, b) => (a.refDate < b.refDate ? 1 : a.refDate > b.refDate ? -1 : 0))
    .slice(0, MAX_COMPS)
    .map(toCompRow);
}

/**
 * As-of, leakage-safe replay of THIS BRANCH's fetchPeerAnchor: community rung
 * (city_region candidates) then city-wide rung, each gated at MIN_PEER_NEFF.
 *
 * FIDELITY NOTE: this branch's fetchPeerAnchor REMOVED the rung-1 cohortOutlierScore
 * ≥ OUTLIER_Z early-return for untrained cohorts (see anchorService.ts: "the previous
 * atypicality early-return is removed; thin-comp cases fall through to rung 2 / null").
 * So untrained cohorts ALWAYS proceed to peerLevelFromComps here too — no atypicality
 * gate. undefined is returned only when there is no community candidate AND no city
 * (mirrors fetchPeerAnchor's `if (cands.length === 0 && !cityKey) return undefined`).
 */
function replayPeer(
  input: AVMInput,
  coefficients: CoefficientRow[],
  community: CompRow[],
  cityWide: CompRow[],
  cityRegionCandCount: number,
  trend: TrendRow[],
  nowMs: number,
  // Rung 1b (anchorService.ts): FSA comps, tried ONLY when the community rung had no
  // key at all. undefined (the default) keeps every pre-FSA replay byte-identical.
  fsaRung?: CompRow[]
): AnchorResult | null | undefined {
  const cityKey = (input.city ?? input.cityRegion).trim();
  if (cityRegionCandCount === 0 && !cityKey) return undefined;
  if (cityRegionCandCount > 0) {
    const peer = peerLevelFromComps(input, community, coefficients, trend, nowMs);
    if (peer && peer.nEff >= MIN_PEER_NEFF) return peer;
  }
  if (cityRegionCandCount === 0 && fsaRung && fsaRung.length > 0) {
    const peer = peerLevelFromComps(input, fsaRung, coefficients, trend, nowMs);
    if (peer && peer.nEff >= MIN_PEER_NEFF) return peer;
  }
  if (cityKey) {
    const peer = peerLevelFromComps(input, cityWide, coefficients, trend, nowMs);
    if (peer && peer.nEff >= MIN_PEER_NEFF) return peer;
  }
  return null;
}

/**
 * Replay THIS BRANCH's calculateAVM for one held-out sale on leakage-safe data.
 * Returns the ResultRow (with the untrained OLD-vs-NEW fields filled when applicable).
 */
async function replaySale(
  s: Sale,
  pool: Sale[],
  snapshot: Snapshot
): Promise<ResultRow | null> {
  const cityRegion = (s.city_region || '').trim();
  // Mirror the live mapper guard (mapListingToAVMInput): blank CityRegion is allowed
  // when a city + valid FSA survive. In default mode blank-region sales never reach
  // here (the eval filter requires city_region), so the baseline is unchanged.
  const fsaEligible = ((s.city || '').trim() && fsaOf(s.postal_code)) as string | boolean;
  if ((!cityRegion && !fsaEligible) || !s.normSub || !s.close_price) return null;

  const input = inputFromSale(s);

  // Live, leakage-safe model resolution (static matrix/audit/ladder/sibling).
  const model = await resolveModel(sb, input);
  const { nativeCoefficients, effectiveCoefficients, r2, basePrice, n, borrowed } = model;
  const staticMarket = marketDataOf(model);
  const untrained = nativeCoefficients.length === 0;

  // As-of trend/offset for this subject (shaped like the live queries).
  const cityKey = input.city ?? input.cityRegion;
  const trend = selectTrendSeries(snapshot.trendRows, cityKey, input.propertySubType) as TrendRow[];
  const offsets = selectOffsets(
    snapshot.offsetRows,
    cityRegionLookupCandidates(cityRegion),
    input.propertySubType
  ) as OffsetRow[];

  // Leakage-safe comps (date < t_S, EXCLUDING S).
  const compWindowStart = isoMinusMonths(s.refDate, COMP_WINDOW_MO);
  const community = communityComps(input, s, pool, s.refDate, compWindowStart);
  const nowMs = Date.parse(s.refDate + 'T00:00:00Z');
  const blankRegion = !cityRegion;
  const fsaRung = blankRegion ? fsaComps(input, s, pool, s.refDate, compWindowStart) : undefined;

  // anchor uses EFFECTIVE (possibly borrowed) coefficients — mirrors calculateAVM.
  // Blank CityRegion → replay fetchGeoFallbackAnchor: FSA comps (city-wide only if the
  // FSA is under MIN_PEER_NEFF and the city pool is bigger), NO community offset (δ_c is
  // relative to the city mean, legitimately zero inside the city).
  let anchorComps = community;
  let anchorOffsets = offsets;
  if (blankRegion) {
    anchorComps = fsaRung ?? [];
    if (anchorComps.length < MIN_PEER_NEFF) {
      const cityPool = cityComps(input, s, pool, s.refDate, compWindowStart);
      if (cityPool.length > anchorComps.length) anchorComps = cityPool;
    }
    anchorOffsets = [];
  }
  const anchor = computeAnchorFromData(input, effectiveCoefficients, basePrice, {
    comps: anchorComps,
    trend,
    offsets: anchorOffsets,
    nowMs,
  });

  // Peer comp-grid — ROUTING gates on NATIVE coefficients (untrained ⟺ always evaluate).
  let peer: AnchorResult | null | undefined;
  if (shouldEvaluatePeers(input, nativeCoefficients)) {
    const cityWide = cityComps(input, s, pool, s.refDate, compWindowStart);
    peer = replayPeer(input, effectiveCoefficients, community, cityWide, new Set(cityRegionLookupCandidates(cityRegion)).size, trend, nowMs, fsaRung);
    if (peer && borrowed) peer.basis = 'borrowed';
  }

  // marketDataOf decides routing vs adjustment coefficients — same as calculateAVM.
  const result: AVMResult = estimateFromMarketData(input, { anchor, peer, ...staticMarket });

  const close = s.close_price;
  const est = result.estimatedValue > 0 ? result.estimatedValue : null;
  const logErr = est !== null ? Math.log(est) - Math.log(close) : null;
  const absPct = est !== null ? Math.abs(est - close) / close : null;
  const inBand =
    est !== null && result.lowBand > 0 && result.highBand > 0
      ? close >= result.lowBand && close <= result.highBand
      : null;

  // ── Untrained OLD baseline: anchor-only with EMPTY coefficients, no peer routing.
  //    This is the pre-fix behaviour (blind cohort average) on the SAME comps. ─────
  let oldEst: number | null = null;
  let oldAbsPct: number | null = null;
  let oldLogErr: number | null = null;
  if (blankRegion) {
    // Blank-region sales have no meaningful "pre-fix" estimate (the pre-fix behaviour
    // was NO estimate at all), so old_* instead scores the CITY-WIDE alternative — the
    // same routing anchored on the whole municipality with the FSA rung disabled. The
    // paired comparison is the evidence for whether neighbourhood comps earn their
    // tighter band, and reportFsa reads it from these fields.
    const cityPool = cityComps(input, s, pool, s.refDate, compWindowStart);
    const altAnchor = computeAnchorFromData(input, effectiveCoefficients, basePrice, {
      comps: cityPool,
      trend,
      offsets: [],
      nowMs,
    });
    let altPeer: AnchorResult | null | undefined;
    if (shouldEvaluatePeers(input, nativeCoefficients)) {
      altPeer = replayPeer(input, effectiveCoefficients, community, cityPool, 0, trend, nowMs);
      if (altPeer && borrowed) altPeer.basis = 'borrowed';
    }
    const altResult = estimateFromMarketData(input, { anchor: altAnchor, peer: altPeer, ...staticMarket });
    oldEst = altResult.estimatedValue > 0 ? altResult.estimatedValue : null;
    if (oldEst !== null) {
      oldAbsPct = Math.abs(oldEst - close) / close;
      oldLogErr = Math.log(oldEst) - Math.log(close);
    }
  } else if (untrained) {
    const oldAnchor = computeAnchorFromData(input, [], basePrice, {
      comps: community,
      trend,
      offsets,
      nowMs,
    });
    // No peer (peer === undefined) → normalEstimate → anchor-only number, exactly the
    // pre-fix path for an untrained cohort.
    const oldResult = estimateFromMarketData(input, {
      anchor: oldAnchor,
      r2,
      basePrice,
      coefficients: [],
      n,
    });
    oldEst = oldResult.estimatedValue > 0 ? oldResult.estimatedValue : null;
    if (oldEst !== null) {
      oldAbsPct = Math.abs(oldEst - close) / close;
      oldLogErr = Math.log(oldEst) - Math.log(close);
    }
  }

  // ── Deal Score as-of grade + realized outcome (--dealscore) ──────────────────
  // The grade a buyer saw just before the sale: final list price, cumulative cut,
  // final DOM, the leakage-safe as-of AVM. expectedSalePrice/closeListRatio are
  // deliberately omitted — equally for every sale, so the stratification is fair
  // (TERMS runs on slightly less evidence than live, same as the terminal did pre-#319).
  let dealGrade: string | null = null;
  let dealScore: number | null = null;
  let closeListRatio: number | null = null;
  let closeAvmRatio: number | null = null;
  let listAvmRatio: number | null = null;
  if (DEALSCORE_MODE && s.list_price && s.list_price > 0) {
    const ds = computeDealScore(
      {
        listPrice: s.list_price,
        originalListPrice: s.original_list_price,
        avmEstimate:
          est !== null && result.confidence !== null
            ? { estimatedValue: est, confidence: result.confidence as 'HIGH' | 'MEDIUM' | 'LOW' }
            : null,
        domDays: s.days_on_market,
        subType: s.property_sub_type,
      },
      'smart'
    );
    dealGrade = ds.grade;
    dealScore = ds.score;
    closeListRatio = close / s.list_price;
    listAvmRatio = est !== null ? s.list_price / est : null;
    closeAvmRatio = est !== null ? close / est : null;
  }

  return {
    listing_key: s.listing_key,
    city: input.city,
    city_region: cityRegion,
    reference_date: s.refDate,
    close_price: close,
    estimated_value: est,
    log_error: logErr,
    abs_pct_error: absPct,
    basis: result.basis,
    confidence: result.confidence,
    n_eff: result.nEff,
    comps: result.comps,
    in_band: inBand,
    price_tier: priceTier(close),
    property_sub_type: s.property_sub_type,
    norm_sub: s.normSub,
    sqft_present: s.building_area_total !== null && s.building_area_total > 0,
    lot_present: s.lot_width !== null && s.lot_width > 0,
    untrained,
    borrowed,
    old_estimated_value: oldEst,
    old_abs_pct_error: oldAbsPct,
    old_log_error: oldLogErr,
    deal_grade: dealGrade,
    deal_score: dealScore,
    close_list_ratio: closeListRatio,
    close_avm_ratio: closeAvmRatio,
    list_avm_ratio: listAvmRatio,
    dom_days: s.days_on_market,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────
function reportOverall(rows: ResultRow[]) {
  const est = rows.filter((r) => r.abs_pct_error !== null);
  const abs = est.map((r) => r.abs_pct_error as number);
  const logs = est.map((r) => r.log_error as number);
  console.log('\n──────── OVERALL ────────');
  console.log(`Sales evaluated:   ${rows.length}  (estimate published: ${est.length}, suppressed: ${rows.length - est.length})`);
  console.log(`Median |%err|:     ${pct(median(abs))}`);
  console.log(`Mean   |%err|:     ${pct(mean(abs))}`);
  console.log(`Bias (mean ln-err):${' ' + mean(logs).toFixed(4)}`);
  console.log(`Hit ±10% / ±20%:   ${pct(est.filter((r) => (r.abs_pct_error as number) <= 0.1).length / est.length)} / ${pct(est.filter((r) => (r.abs_pct_error as number) <= 0.2).length / est.length)}`);
  console.log(`Band coverage:     ${pct(est.filter((r) => r.in_band === true).length / est.length)}`);

  const tiers = ['<500k', '500k-1M', '1M-1.5M', '1.5M-2M', '2M+'];
  console.log('\nBy price tier (median |%err|, mean |%err|, n):');
  for (const t of tiers) {
    const sub = est.filter((r) => r.price_tier === t);
    if (sub.length === 0) { console.log(`   ${t.padEnd(10)} n=0`); continue; }
    const a = sub.map((r) => r.abs_pct_error as number);
    console.log(`   ${t.padEnd(10)} ${pct(median(a))}   mean ${pct(mean(a))}   n=${sub.length}`);
  }
}

function reportUntrained(rows: ResultRow[]) {
  const u = rows.filter((r) => r.untrained);
  // NEW (full routing) vs OLD (anchor-only, empty coeffs) on the SAME leakage-safe comps.
  // Compare only rows where BOTH produced a number (apples-to-apples).
  const both = u.filter((r) => r.abs_pct_error !== null && r.old_abs_pct_error !== null);
  const newAbs = both.map((r) => r.abs_pct_error as number);
  const oldAbs = both.map((r) => r.old_abs_pct_error as number);
  const newLog = both.map((r) => r.log_error as number);
  const oldLog = both.map((r) => r.old_log_error as number);
  const improved = both.filter((r) => (r.abs_pct_error as number) < (r.old_abs_pct_error as number)).length;

  console.log('\n──────── UNTRAINED-COHORT SUBSET (leakage-safe OLD vs NEW) ────────');
  console.log(`Untrained sales:        ${u.length}  (NEW published: ${u.filter((r) => r.abs_pct_error !== null).length}, OLD published: ${u.filter((r) => r.old_abs_pct_error !== null).length})`);
  console.log(`Paired (both published): ${both.length}`);
  if (both.length > 0) {
    console.log(`  OLD  median |%err|:  ${pct(median(oldAbs))}   mean ${pct(mean(oldAbs))}   bias ${mean(oldLog).toFixed(4)}`);
    console.log(`  NEW  median |%err|:  ${pct(median(newAbs))}   mean ${pct(mean(newAbs))}   bias ${mean(newLog).toFixed(4)}`);
    console.log(`  % improved (NEW<OLD): ${pct(improved / both.length)}`);
  }
  // Confidence distribution among ALL untrained NEW estimates (must have 0 HIGH).
  const pub = u.filter((r) => r.abs_pct_error !== null);
  const conf = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<string, number>;
  for (const r of pub) conf[r.confidence] = (conf[r.confidence] ?? 0) + 1;
  console.log(`  NEW confidence dist:  HIGH=${conf.HIGH ?? 0}  MEDIUM=${conf.MEDIUM ?? 0}  LOW=${conf.LOW ?? 0}  ${(conf.HIGH ?? 0) === 0 ? '(0 HIGH ✓)' : '(⚠ HIGH PRESENT)'}`);
  // Basis distribution (diagnostic).
  const basis: Record<string, number> = {};
  for (const r of pub) basis[r.basis] = (basis[r.basis] ?? 0) + 1;
  console.log(`  NEW basis dist:       ${Object.entries(basis).map(([k, v]) => `${k}=${v}`).join('  ')}`);
}

/**
 * --fsa report. Two questions, in order of importance:
 *  1. Does the FSA cohort beat the city-wide alternative on the SAME sales? (old_* holds
 *     the city-wide estimate in this mode — see replaySale.)
 *  2. Is each confidence label EARNED — does realised error stratify by label, and does
 *     the band cover the close at a rate consistent with the label? This is the evidence
 *     for/against "fix the low confidence": if MEDIUM-labelled FSA estimates hit
 *     MEDIUM-grade error, the labels are honest as-is; if not, no relabelling is defensible.
 */
/**
 * --dealscore report. The claim under test: grades are PREDICTIVE — an A+ buyer
 * realizes a better outcome than a D buyer. Outcomes per grade, then per raw
 * price-vs-value band (the PRICE pillar's input, free of the TERMS↔close/list
 * circularity: cuts and DOM sit on both sides of the full score).
 *
 * Reading close/AVM: the as-of AVM is the value yardstick, so close/AVM < 1 means the
 * buyer paid under market value. If grades work, close/AVM rises monotonically from
 * A+ to F. close/list is reported but is the WEAK evidence — a deep price cut both
 * raises TERMS and mechanically lowers close/list's denominator.
 */
function reportDealScore(rows: ResultRow[]) {
  const graded = rows.filter((r) => r.deal_grade !== null);
  const withheld = rows.filter((r) => r.deal_grade === null && r.close_list_ratio !== null);
  console.log('\n──────── DEAL SCORE TRACK RECORD (as-of grades vs realized outcomes) ────────');
  console.log(`Sales graded: ${graded.length}   withheld (no as-of AVM): ${withheld.length}`);

  const line = (label: string, sub: ResultRow[]) => {
    if (sub.length === 0) { console.log(`  ${label.padEnd(9)} n=0`); return; }
    const cl = sub.map((r) => r.close_list_ratio as number).filter((x) => x !== null);
    const ca = sub.map((r) => r.close_avm_ratio).filter((x): x is number => x !== null);
    const dom = sub.map((r) => r.dom_days).filter((x): x is number => x !== null);
    const overAsk = cl.filter((x) => x > 1).length / (cl.length || 1);
    console.log(
      `  ${label.padEnd(9)} n=${String(sub.length).padEnd(6)}` +
      `close/AVM ${ca.length ? (median(ca) * 100).toFixed(1) + '%' : '  n/a'}   ` +
      `close/list ${(median(cl) * 100).toFixed(1)}%   ` +
      `over-ask ${pct(overAsk)}   ` +
      `median DOM ${dom.length ? Math.round(median(dom)) : 'n/a'}`
    );
  };

  console.log('\nBy GRADE (Homebuyer lens):');
  for (const g of ['A+', 'A', 'B', 'C', 'D', 'F']) line(g, graded.filter((r) => r.deal_grade === g));
  line('withheld', withheld);

  console.log('\nBy PRICE-vs-VALUE band alone (list/as-of-AVM — the PRICE pillar input):');
  const bands: Array<[string, (x: number) => boolean]> = [
    ['<=0.90', (x) => x <= 0.9],
    ['0.90-0.95', (x) => x > 0.9 && x <= 0.95],
    ['0.95-1.00', (x) => x > 0.95 && x <= 1.0],
    ['1.00-1.05', (x) => x > 1.0 && x <= 1.05],
    ['1.05-1.10', (x) => x > 1.05 && x <= 1.1],
    ['>1.10', (x) => x > 1.1],
  ];
  for (const [label, fn] of bands) {
    line(label, rows.filter((r) => r.list_avm_ratio !== null && fn(r.list_avm_ratio)));
  }

  console.log(
    '\nCaveats carried, not hidden: SURVIVORSHIP (only closed sales are here — grade→sell-' +
    'through is not measurable from this set) and the TERMS↔close/list mechanical link ' +
    '(the price-band table is the clean read on the PRICE pillar).'
  );
}

function reportFsa(rows: ResultRow[]) {
  const pub = rows.filter((r) => r.abs_pct_error !== null);
  console.log('\n──────── FSA-COHORT SUBSET (blank CityRegion — leakage-safe) ────────');
  console.log(`Sales evaluated:  ${rows.length}   FSA published: ${pub.length}   city-wide published: ${rows.filter((r) => r.old_abs_pct_error !== null).length}`);

  const both = rows.filter((r) => r.abs_pct_error !== null && r.old_abs_pct_error !== null);
  if (both.length > 0) {
    const fsaAbs = both.map((r) => r.abs_pct_error as number);
    const cityAbs = both.map((r) => r.old_abs_pct_error as number);
    const improved = both.filter((r) => (r.abs_pct_error as number) < (r.old_abs_pct_error as number)).length;
    console.log(`\nPaired FSA vs CITY-WIDE (${both.length} sales, same leakage-safe data):`);
    console.log(`  CITY  median |%err|:  ${pct(median(cityAbs))}   mean ${pct(mean(cityAbs))}   bias ${mean(both.map((r) => r.old_log_error as number)).toFixed(4)}`);
    console.log(`  FSA   median |%err|:  ${pct(median(fsaAbs))}   mean ${pct(mean(fsaAbs))}   bias ${mean(both.map((r) => r.log_error as number)).toFixed(4)}`);
    console.log(`  % improved (FSA<CITY): ${pct(improved / both.length)}`);
  }

  console.log('\nConfidence calibration (label must EARN its error, not assert it):');
  for (const label of ['HIGH', 'MEDIUM', 'LOW']) {
    const sub = pub.filter((r) => r.confidence === label);
    if (sub.length === 0) { console.log(`  ${label.padEnd(6)} n=0`); continue; }
    const a = sub.map((r) => r.abs_pct_error as number);
    const banded = sub.filter((r) => r.in_band !== null);
    const cov = banded.length > 0 ? banded.filter((r) => r.in_band === true).length / banded.length : null;
    console.log(
      `  ${label.padEnd(6)} n=${String(sub.length).padEnd(5)} median |%err| ${pct(median(a))}   ` +
      `mean ${pct(mean(a))}   hit ±10% ${pct(a.filter((x) => x <= 0.1).length / a.length)}   band coverage ${cov !== null ? pct(cov) : 'n/a'}`
    );
  }

  const basis: Record<string, number> = {};
  for (const r of pub) basis[r.basis] = (basis[r.basis] ?? 0) + 1;
  console.log(`\nBasis dist: ${Object.entries(basis).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  const byCity = new Map<string, number[]>();
  for (const r of pub) {
    const arr = byCity.get(r.city ?? '?') ?? [];
    arr.push(r.abs_pct_error as number);
    byCity.set(r.city ?? '?', arr);
  }
  console.log('By city (median |%err|, n):');
  for (const [city, a] of [...byCity.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, 10)) {
    console.log(`   ${city.padEnd(18)} ${pct(median(a))}   n=${a.length}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fidelity check: NOW-dated window (no leakage filter) must match live calculateAVM.
// ─────────────────────────────────────────────────────────────────────────────
// The last two are blank-CityRegion listings (Kitchener condo apt, Brantford detached)
// — they exercise the FSA-cohort path end-to-end: live fetchGeoFallbackAnchor +
// sold_fsa_comps RPC vs the harness's in-memory fsaComps replay.
const FIDELITY_KEYS = ['N13229524', 'W13168260', 'N13135326', 'X12693810', 'X12401356'];

async function liveAVMForKey(key: string): Promise<{ input: AVMInput; r: AVMResult } | null> {
  const { data: row } = await sb
    .from('listings')
    .select('listing_key, full_payload')
    .eq('listing_key', key)
    .maybeSingle();
  if (!row) return null;
  const payload = row.full_payload as Record<string, unknown>;
  const rooms: RoomData[] = Array.isArray(payload?.rooms) ? (payload.rooms as RoomData[]) : [];
  let bucketCalibration: BucketCalibration | null = null;
  // CityRegion ?? City — mirrors getListingDetail / the build script (calibrationRegionKey)
  // so fidelity keys the same cohort the live path does for blank-CityRegion listings.
  const cityRegion = calibrationRegionKey(
    typeof payload?.CityRegion === 'string' ? (payload.CityRegion as string) : null,
    typeof payload?.City === 'string' ? (payload.City as string) : null
  );
  const subType = String(payload?.PropertySubType ?? '').trim();
  const bucket = String(payload?.LivingAreaRange ?? '').trim();
  if (cityRegion && subType && bucket && resolveLivingArea(payload, { rooms }).source === 'range_midpoint') {
    const { data: cal } = await sb
      .from('avm_sqft_calibration')
      .select('median_gla, sample_count')
      .eq('city_region', cityRegion)
      .ilike('property_sub_type', subType)
      .eq('living_area_range', bucket)
      .maybeSingle();
    if (cal && Number(cal.median_gla) > 0) {
      bucketCalibration = { medianGla: Number(cal.median_gla), sampleCount: Number(cal.sample_count) };
    }
  }
  const input = mapListingToAVMInput(payload, { rooms, bucketCalibration });
  if (!input) return null;
  const r = await calculateAVM(sb, input);
  return { input, r };
}

/**
 * Reproduce the harness's estimate for a given AVMInput with a NOW-dated, NON-leakage
 * window (comps within the live COMP_WINDOW_MO ending today, NO date<t_S filter, full
 * pool). This should equal LIVE calculateAVM up to the comp-window edge / snapshot
 * staleness differences; the routing (basis/confidence) and the estimate must match.
 */
async function harnessNowEstimate(input: AVMInput, pool: Sale[], expanded: Map<string, Matrix>): Promise<AVMResult> {
  const nowMs = Date.now();
  const windowStartIso = monthsAgoIso(COMP_WINDOW_MO);
  // NOW snapshot = trailing TREND_WINDOW months up to today (no cutoff).
  const snap = buildSnapshot(pool, expanded, monthsAgoIso(TREND_WINDOW_MONTHS), null);

  const model = await resolveModel(sb, input);
  const { nativeCoefficients, effectiveCoefficients, basePrice, borrowed } = model;
  const cityKey = input.city ?? input.cityRegion;
  const trend = selectTrendSeries(snap.trendRows, cityKey, input.propertySubType) as TrendRow[];
  const offsets = selectOffsets(snap.offsetRows, cityRegionLookupCandidates(input.cityRegion), input.propertySubType) as OffsetRow[];

  // Synthetic Sale for comp filtering (no exclusion key; future = now).
  const synthetic: Sale = {
    listing_key: '__SUBJECT__', close_price: null, purchase_contract_date: null, close_date: null,
    city: input.city, city_region: input.cityRegion, property_sub_type: input.rawPropertySubType,
    building_area_total: input.buildingAreaTotal, lot_width: input.lotWidth, lot_depth: input.lotDepth ?? null,
    bedrooms_above_grade: input.bedroomsAboveGrade, bedrooms_below_grade: input.bedroomsBelowGrade,
    bathrooms_total_integer: input.bathroomsTotalInteger,
    parking_total: input.parkingTotal, interior_tier: null, exterior_tier: null, basement_tier: null,
    postal_code: input.postalCode ?? null,
    list_price: null, original_list_price: null, days_on_market: null,
    refDate: '9999-12-31', normSub: input.propertySubType, period: '9999-12-31',
  };
  const community = communityComps(input, synthetic, pool, '9999-12-31', windowStartIso);

  // Blank CityRegion → same fetchGeoFallbackAnchor replay as replaySale (FSA comps,
  // city-wide only when the FSA is under MIN_PEER_NEFF, no community offset).
  const blankRegion = !input.cityRegion.trim();
  const fsaRung = blankRegion ? fsaComps(input, synthetic, pool, '9999-12-31', windowStartIso) : undefined;
  let anchorComps = community;
  let anchorOffsets = offsets;
  if (blankRegion) {
    anchorComps = fsaRung ?? [];
    if (anchorComps.length < MIN_PEER_NEFF) {
      const cityPool = cityComps(input, synthetic, pool, '9999-12-31', windowStartIso);
      if (cityPool.length > anchorComps.length) anchorComps = cityPool;
    }
    anchorOffsets = [];
  }

  const anchor = computeAnchorFromData(input, effectiveCoefficients, basePrice, { comps: anchorComps, trend, offsets: anchorOffsets, nowMs });
  let peer: AnchorResult | null | undefined;
  if (shouldEvaluatePeers(input, nativeCoefficients)) {
    const cityWide = cityComps(input, synthetic, pool, '9999-12-31', windowStartIso);
    peer = replayPeer(input, effectiveCoefficients, community, cityWide, new Set(cityRegionLookupCandidates(input.cityRegion)).size, trend, nowMs, fsaRung);
    if (peer && borrowed) peer.basis = 'borrowed';
  }
  return estimateFromMarketData(input, { anchor, peer, ...marketDataOf(model) });
}

async function runFidelity(pool: Sale[], expanded: Map<string, Matrix>) {
  console.log('\n──────── FIDELITY CHECK (harness NOW-window vs LIVE calculateAVM) ────────');
  let allMatch = true;
  for (const key of FIDELITY_KEYS) {
    const live = await liveAVMForKey(key);
    if (!live) { console.log(`  ${key}: NOT FOUND (skipped)`); continue; }
    const h = await harnessNowEstimate(live.input, pool, expanded);
    const L = live.r, H = h;
    const relDiff = L.estimatedValue > 0 && H.estimatedValue > 0
      ? Math.abs(H.estimatedValue - L.estimatedValue) / L.estimatedValue : null;
    const basisMatch = L.basis === H.basis;
    const confMatch = L.confidence === H.confidence;
    // Estimate "matches" if basis+confidence agree and the value is within 3% (comp-window
    // edge + as-of snapshot staleness vs the live future-laden trend table cause tiny drift).
    const valMatch = relDiff !== null && relDiff <= 0.03;
    const ok = basisMatch && confMatch && (valMatch || (L.estimatedValue === 0 && H.estimatedValue === 0));
    if (!ok) allMatch = false;
    const fmt = (n: number) => n > 0 ? '$' + Math.round(n).toLocaleString() : 'UNAVAIL';
    console.log(`  ${key}  ${ok ? 'MATCH ✓' : 'MISMATCH ✗'}`);
    console.log(`     LIVE     est=${fmt(L.estimatedValue)}  basis=${L.basis}  conf=${L.confidence}  comps=${L.comps}`);
    console.log(`     HARNESS  est=${fmt(H.estimatedValue)}  basis=${H.basis}  conf=${H.confidence}  comps=${H.comps}  relDiff=${relDiff !== null ? (relDiff * 100).toFixed(2) + '%' : 'n/a'}`);
  }
  console.log(`\n  FIDELITY: ${allMatch ? 'PASS ✓ (routing replication faithful)' : 'FAIL ✗ (routing replication WRONG — do not trust numbers)'}`);
  return allMatch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  AVM branch-faithful out-of-time backtest  (feat/avm-untrained-cohort)');
  console.log(`  run_id=${RUN_ID}  ${LEAKY ? 'LEAKY (self-test)' : 'clean'}${FIDELITY ? '  +FIDELITY' : ''}`);
  console.log(`  eval: last ${EVAL_MONTHS} mo · trend: ${TREND_WINDOW_MONTHS} mo · comp: ${COMP_WINDOW_MO} mo · lease floor: $${MIN_SALE_PRICE.toLocaleString()}`);
  if (Number.isFinite(EVAL_LIMIT)) console.log(`  eval limit: ${EVAL_LIMIT}`);
  console.log('========================================');

  const evalWindowStart = monthsAgoIso(EVAL_MONTHS);
  const poolWindowStart = monthsAgoIso(EVAL_MONTHS + TREND_WINDOW_MONTHS + 1);

  console.log(`Loading matrix (snapshot feature-adjust only)…`);
  const expanded = await loadMatricesForSnapshot();
  console.log(`   ${expanded.size} candidate-expanded matrix keys.`);

  console.log(`Streaming raw_vow_sold (purchase_contract_date >= ${poolWindowStart})…`);
  const pool: Sale[] = [];
  let cursor = '';
  for (;;) {
    let page: PoolRow[] | null;
    try {
      page = await readPoolPage(cursor, poolWindowStart);
    } catch (e) {
      console.error(`${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
      return;
    }
    if (!page || page.length === 0) break;
    for (const r of page) {
      cursor = r.listing_key;
      const refDate = (r.purchase_contract_date || r.close_date || '').slice(0, 10);
      if (!refDate) continue;
      pool.push({ ...r, refDate, normSub: normalizePropertySubType(r.property_sub_type), period: periodEndForDate(refDate) });
    }
    if (page.length < READ_PAGE) break;
    await sleep(INTER_CHUNK_DELAY_MS);
  }
  console.log(`   pool size: ${pool.length}`);

  if (FIDELITY) {
    const ok = await runFidelity(pool, expanded);
    if (!ok) process.exitCode = 1;
    // Fidelity is a standalone gate; still continue to the backtest if --limit given.
    if (!Number.isFinite(EVAL_LIMIT)) return;
  }

  // Eval set: sales in the last EVAL_MONTHS, most-recent first, capped by --limit.
  // Default: sales WITH a community key (every prior baseline). --fsa: the exact
  // complement — blank city_region, city + valid FSA present (the population the
  // FSA-cohort path exists for, invisible to every previous run).
  let evalSales = pool
    .filter((s) =>
      s.refDate >= evalWindowStart &&
      s.normSub &&
      (FSA_MODE
        ? !(s.city_region || '').trim() && (s.city || '').trim() && fsaOf(s.postal_code)
        : DEALSCORE_MODE
          ? // Deal Score grades the whole book: keyed sales AND blank-region ones the
            // FSA path now prices — plus a sane final list price to grade against.
            ((s.city_region || '').trim() || ((s.city || '').trim() && fsaOf(s.postal_code))) &&
            s.list_price !== null &&
            s.list_price > 0
          : (s.city_region || '').trim())
    )
    .sort((a, b) => (a.refDate < b.refDate ? 1 : a.refDate > b.refDate ? -1 : 0));
  if (Number.isFinite(EVAL_LIMIT)) evalSales = evalSales.slice(0, EVAL_LIMIT);
  console.log(`\nEvaluating ${evalSales.length} held-out sales…`);

  // Snapshots: clean = per-evaluation-period (data before the period start); leaky =
  // one snapshot over the WHOLE pool (sees the future — must score better).
  const snapshotCache = new Map<string, Snapshot>();
  const leakySnapshot = LEAKY ? buildSnapshot(pool, expanded, poolWindowStart, null) : null;
  const snapshotFor = (period: string): Snapshot => {
    if (LEAKY) return leakySnapshot!;
    let snap = snapshotCache.get(period);
    if (!snap) {
      const pStart = periodStart(period);
      snap = buildSnapshot(pool, expanded, isoMinusMonths(pStart, TREND_WINDOW_MONTHS), pStart);
      snapshotCache.set(period, snap);
    }
    return snap;
  };

  const results: ResultRow[] = [];
  let done = 0;
  for (const s of evalSales) {
    const row = await replaySale(s, pool, snapshotFor(s.period));
    if (row) results.push(row);
    if (++done % 2000 === 0) console.log(`   …replayed ${done}/${evalSales.length}`);
  }

  reportOverall(results);
  if (FSA_MODE) reportFsa(results);
  else if (DEALSCORE_MODE) reportDealScore(results);
  else reportUntrained(results);

  // Local results file (READ-ONLY on DB — nothing is written to Supabase).
  const summary = {
    run_id: RUN_ID,
    leaky: LEAKY,
    generated_at: new Date().toISOString(),
    params: { evalMonths: EVAL_MONTHS, trendWindowMo: TREND_WINDOW_MONTHS, compWindowMo: COMP_WINDOW_MO, minSalePrice: MIN_SALE_PRICE, limit: Number.isFinite(EVAL_LIMIT) ? EVAL_LIMIT : null },
    n: results.length,
    results,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${results.length} result rows to ${OUT_PATH} (local file; DB untouched).`);
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
