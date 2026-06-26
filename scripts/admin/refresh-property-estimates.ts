/**
 * Shadow MLS — Refresh property_estimates from active listings.
 *
 * Precomputes the PureProperty Estimate (AVM) + resolved living area / $psf per
 * ACTIVE listing so the Compare page reads a ready-made estimate in one batched PK
 * lookup instead of running the multi-query AVM live (seconds → instant).
 *
 * SHARED CORE (no divergence): builds the AVMInput with the SAME mapListingToAVMInput
 * the detail page uses, looks up anchor/audit/coefficients with the SAME service
 * functions, and runs the SAME estimateFromMarketData math (src/lib/avm/calculator.ts).
 * So a row here equals what /properties/[id] computes at request time. Deterministic,
 * no AI (CLAUDE.md §4). raw_vow_sold is read READ-ONLY for the anchor (§12).
 *
 * IO-FRUGAL (cf. Disk IO Budget incident — memory supabase-io-budget):
 *   - keyset pagination on listing_key (no slow OFFSET); full_payload detoasts per row
 *     so pages are small + paced, with timeout backoff/retry.
 *   - anchor/audit/coefficients fetched ONCE per market and memoized (a few hundred
 *     markets, ~3 queries each) — per-listing work is then pure arithmetic.
 *   - avm_sqft_calibration loaded once into memory (the AVM's no-rooms fallback).
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-property-estimates.ts               # dry-run (no writes)
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-property-estimates.ts --limit 2000  # dry-run, first 2000 rows
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-property-estimates.ts --apply        # write full table
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-property-estimates.ts --apply --since 2026-06-24T03:00:00Z  # delta: only listings re-synced since
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-property-estimates.ts --apply --shard 1/5  # full table, slice 1 of 5 (by last digit of listing_key)
 *
 * The nightly daily-sync workflow runs the --since (delta) form so it finishes in
 * minutes. The weekly weekly-estimates-recompute workflow runs the bare --apply (full
 * table) form sharded across a parallel matrix (--shard i/n) to re-base every row
 * against the latest market anchors — the unsharded full run exceeds the 6h job cap.
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as https from 'https';
import crossFetch from 'cross-fetch';
import { mapListingToAVMInput } from '@/lib/avm/mapListingToAVMInput';
import { resolveLivingArea, type BucketCalibration } from '@/lib/avm/livingArea';
import { estimateFromMarketData, shouldEvaluatePeers, resolveModel, type AVMMarketData } from '@/lib/avm/calculator';
import { fetchAnchor, fetchPeerAnchor, type AnchorResult } from '@/lib/avm/anchorService';
import { type CoefficientRow } from '@/lib/avm/matrixService';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';
import type { RoomData } from '@/lib/room-utils';

// Patch global fetch with a TLS-relaxed agent for the Supabase client.
const agent = new https.Agent({ rejectUnauthorized: false });
(global as unknown as { fetch: typeof fetch }).fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
  // @ts-expect-error agent is a node-fetch option, not standard
  crossFetch(url, { ...init, agent })) as typeof fetch;

// ── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const ROW_LIMIT = limitArg
  ? parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1], 10)
  : Infinity;

// Delta window (nightly): when set, ONLY listings whose listings.synced_at is at/after
// this ISO timestamp are refreshed. A listing's estimate inputs only change when the
// daily sync re-ingests it (price/status/payload bump), so a delta pass keeps the same
// rows fresh as a full recompute would — at a fraction of the cost. Omit --since for a
// full-table recompute (e.g. a periodic workflow_dispatch run that re-bases every row
// against the latest market anchors). This is what stops the step from scanning ~77k
// rows nightly and blowing the GitHub Actions 6h job ceiling.
const sinceArg = process.argv.find((a) => a.startsWith('--since'));
const SINCE = sinceArg
  ? (sinceArg.includes('=') ? sinceArg.split('=')[1] : process.argv[process.argv.indexOf(sinceArg) + 1])
  : undefined;

// Shard ("--shard i/n", 1-based): partition the full table into n disjoint slices by
// the LAST DIGIT of listing_key (TREB MLS suffixes are numeric → digits are uniformly
// distributed, so the slices are balanced). Shard i owns the digits d where d % n ==
// i-1. Lets the WEEKLY full recompute (no --since) run as a parallel matrix so each
// shard finishes well inside a single GitHub 6h job — the whole-table run on its own
// exceeds 6h. Ignored when --since is set (a delta is already small enough). Assumes
// numeric-suffixed keys (true for the TRREB IDX/VOW feeds); any non-digit-suffixed key
// would fall outside every shard, so do NOT use --shard for a guaranteed-complete pass
// on a feed with alphanumeric suffixes — use the bare full run there.
const shardArg = process.argv.find((a) => a.startsWith('--shard'));
let SHARD_DIGITS: string[] | null = null;
if (shardArg && !SINCE) {
  const raw = shardArg.includes('=')
    ? shardArg.split('=')[1]
    : process.argv[process.argv.indexOf(shardArg) + 1];
  const [iStr, nStr] = String(raw ?? '').split('/');
  const i = parseInt(iStr, 10);
  const n = parseInt(nStr, 10);
  if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > 10 || i < 1 || i > n) {
    console.error(`❌ invalid --shard "${raw}" — expected "i/n" with 1 <= i <= n <= 10`);
    process.exit(1);
  }
  SHARD_DIGITS = [];
  for (let d = 0; d < 10; d++) if (d % n === i - 1) SHARD_DIGITS.push(String(d));
}

// ── IO pacing (deliberately gentle) ──────────────────────────────────────────
const CHUNK_SIZE = 400; // rows per read page (each detoasts full_payload)
const UPSERT_CHUNK = 200; // rows per array-upsert
const INTER_CHUNK_DELAY_MS = 400;
const MAX_READ_RETRIES = 5;

// For-sale floor + terminal statuses to exclude (mirror migration 020's active filter).
const PRICE_FLOOR = 50000;
const TERMINAL_STATUSES = new Set([
  'sold',
  'closed',
  'closed sale',
  'leased',
  'terminated',
  'expired',
  'suspended',
]);

// PropertySubType values the AVM was never trained on — running them produces
// noise (Parking Space estimated at $24k from a stray coefficient, etc.). For
// these we still compute GLA/ppsf so Compare can render $/sqft when present, but
// we leave estimated_value=null so the UI shows "Insufficient comps".
const NON_RESIDENTIAL_SUBTYPES = new Set([
  'parking space',
  'locker',
  'vacant land',
  'mobile/trailer',
  'sale of business',
]);
const NON_RESIDENTIAL_PREFIXES = ['office', 'commercial', 'industrial', 'retail'];

function isNonResidentialSubType(sub: unknown): boolean {
  const s = String(sub ?? '').toLowerCase().trim();
  if (!s) return false;
  if (NON_RESIDENTIAL_SUBTYPES.has(s)) return true;
  return NON_RESIDENTIAL_PREFIXES.some((p) => s.startsWith(p));
}

// Schema bounds for property_estimates NUMERIC columns. Used to drop rows that
// would otherwise sink an entire 200-row upsert batch on overflow.
const MAX_ESTIMATED_VALUE = 9_999_999_999.99;   // NUMERIC(12,2)
const MAX_ANCHOR_PRICE    = 9_999_999_999.99;   // NUMERIC(12,2)
const MAX_PPSF            = 99_999_999.99;      // NUMERIC(10,2)
const MAX_GLA_SQFT        = 99_999_999.99;      // NUMERIC(10,2)
const MAX_R2_SCORE        = 9.9999;             // NUMERIC(5,4)
// total_adjustment_pct is NUMERIC(8,5) → ±999.99999. Clamp to ±5 (well above the
// model's ±0.4 ADJ_CLAMP) so a math anomaly never overflows the column.
const ADJUSTMENT_PCT_CLAMP = 5;

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ListingRow {
  listing_key: string;
  list_price: number | string | null;
  full_payload: Record<string, unknown> | null;
}

interface EstimateRow {
  listing_key: string;
  estimated_value: number | null;
  confidence: string | null;
  r2_score: number | null;
  anchor_price: number | null;
  total_adjustment_pct: number | null;
  gla_sqft: number | null;
  ppsf: number | null;
  computed_at: string;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// Mirror migration 020: for-sale floor + non-terminal status (coalesce Status chain).
function isActive(payload: Record<string, unknown> | null, listPrice: number | null): boolean {
  if (listPrice === null || listPrice < PRICE_FLOOR) return false;
  const status = String(
    payload?.['Status'] ?? payload?.['MlsStatus'] ?? payload?.['StandardStatus'] ?? ''
  )
    .toLowerCase()
    .trim();
  return !TERMINAL_STATUSES.has(status);
}

// ── In-memory calibration map (AVM no-rooms fallback) ────────────────────────
// Key EXACTLY as getListingDetail looks it up: raw CityRegion (trimmed, case-
// sensitive) || normalized sub-type || raw LivingAreaRange bucket.
const calibration = new Map<string, BucketCalibration>();

async function loadCalibration(): Promise<void> {
  const { data, error } = await sb
    .from('avm_sqft_calibration')
    .select('city_region, property_sub_type, living_area_range, median_gla, sample_count');
  if (error) {
    console.warn(`   ⚠️  calibration load failed (continuing without fallback): ${error.message}`);
    return;
  }
  for (const r of data ?? []) {
    const key = `${r.city_region}||${r.property_sub_type}||${r.living_area_range}`;
    const medianGla = Number(r.median_gla);
    if (medianGla > 0) {
      calibration.set(key, { medianGla, sampleCount: Number(r.sample_count) || 0 });
    }
  }
  console.log(`   ✅ Loaded ${calibration.size} calibration cohorts\n`);
}

function lookupCalibration(payload: Record<string, unknown>, rooms: RoomData[]): BucketCalibration | null {
  // Only the range-midpoint path uses the calibrated bucket (matches getListingDetail).
  if (resolveLivingArea(payload, { rooms }).source !== 'range_midpoint') return null;
  const cityRegion = String(payload?.['CityRegion'] ?? '').trim();
  const subType =
    typeof payload?.['PropertySubType'] === 'string'
      ? normalizePropertySubType(payload['PropertySubType'] as string)
      : '';
  const bucket = String(payload?.['LivingAreaRange'] ?? '').trim();
  if (!cityRegion || !subType || !bucket) return null;
  return calibration.get(`${cityRegion}||${subType}||${bucket}`) ?? null;
}

// ── Per-listing AVM caching ──────────────────────────────────────────────────
// The anchor pipeline depends on (cityRegion, sub_type, City, rawSubType) but the
// borrow resolution (native vs sibling coefficients) is stable per cohort — memoize
// the resolved model so each distinct cohort pays the DB cost once.
// INVARIANT: uses resolveModel (same as calculateAVM) so the batch is byte-identical
// to the request path for every listing: native coefficients gate routing, effective
// (possibly borrowed) coefficients drive adjustment, peer.basis='borrowed' when borrowed.
interface MarketStaticData {
  nativeCoefficients: CoefficientRow[];
  effectiveCoefficients: CoefficientRow[];
  r2: number | null;
  basePrice: number | null;
  n: number | null | undefined;
  borrowed: boolean;
}
const marketStaticCache = new Map<string, MarketStaticData>();

async function getMarketStatic(
  cityRegion: string,
  normalizedType: string,
  city: string | null,
  rawPropertySubType: string
): Promise<MarketStaticData> {
  // Cache key: cohort identity (city + subType determine the sibling search scope,
  // so include city to avoid serving Aurora's sibling model to a different city's
  // untrained cohort with the same cityRegion name).
  const key = `${cityRegion.toLowerCase()}|${normalizedType.toLowerCase()}|${(city ?? '').toLowerCase()}`;
  const cached = marketStaticCache.get(key);
  if (cached) return cached;
  const resolved = await resolveModel(sb, {
    cityRegion,
    propertySubType: normalizedType,
    city,
    rawPropertySubType,
  });
  const market: MarketStaticData = {
    nativeCoefficients: resolved.nativeCoefficients,
    effectiveCoefficients: resolved.effectiveCoefficients,
    r2: resolved.r2,
    basePrice: resolved.basePrice,
    n: resolved.n,
    borrowed: resolved.borrowed,
  };
  marketStaticCache.set(key, market);
  return market;
}

async function readPage(cursor: string, pageSize: number): Promise<ListingRow[] | null> {
  let attempt = 0;
  for (;;) {
    // Keyset-paginate on the PK (listing_key) and FILTER on synced_at when delta —
    // never ORDER on synced_at (unindexed → statement timeout, CLAUDE.md §12). The
    // synced_at filter also short-circuits full_payload detoast for the ~95% of rows
    // that didn't change today, which is the bulk of the cost.
    let query = sb
      .from('listings')
      .select('listing_key, list_price, full_payload')
      .gt('listing_key', cursor)
      .gte('list_price', PRICE_FLOOR);
    if (SINCE) query = query.gte('synced_at', SINCE);
    // Disjoint shard slice: last digit of listing_key ∈ this shard's digit set. The
    // filter runs in PostgREST (before projection), so non-shard rows are never
    // detoasted — that's what splits the expensive full_payload read across the matrix.
    if (SHARD_DIGITS) query = query.or(SHARD_DIGITS.map((d) => `listing_key.like.*${d}`).join(','));
    const { data, error } = await query
      .order('listing_key', { ascending: true })
      .limit(pageSize);

    if (!error) return data as unknown as ListingRow[] | null;

    attempt++;
    const isTimeout = /timeout|57014|canceling statement/i.test(error.message);
    if (attempt > MAX_READ_RETRIES) {
      throw new Error(
        `read failed at cursor "${cursor}" after ${MAX_READ_RETRIES} retries: ${error.message}`
      );
    }
    const backoff = Math.min(30000, 3000 * 2 ** (attempt - 1));
    console.warn(
      `   ⏳ Read ${isTimeout ? 'timed out' : 'errored'} at cursor "${cursor}" ` +
        `(attempt ${attempt}/${MAX_READ_RETRIES}): ${error.message} — backing off ${backoff}ms…`
    );
    await sleep(backoff);
  }
}

async function flush(rows: EstimateRow[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await sb
      .from('property_estimates')
      .upsert(chunk, { onConflict: 'listing_key' });
    if (error) {
      failed += chunk.length;
      console.warn(`   ⚠️  upsert chunk @${i} failed: ${error.message}`);
    } else {
      ok += chunk.length;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }
  return { ok, failed };
}

async function main() {
  console.log('========================================');
  console.log('  Refresh property_estimates ← active listings');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  console.log(`  Scope: ${SINCE ? `DELTA (synced_at >= ${SINCE})` : 'FULL TABLE'}`);
  if (SHARD_DIGITS) console.log(`  Shard: listing_key ending in {${SHARD_DIGITS.join(', ')}}`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`  Row limit: ${ROW_LIMIT}`);
  console.log('========================================\n');

  await loadCalibration();

  let cursor = '';
  let scanned = 0;
  let active = 0;
  let withEstimate = 0;
  let withGla = 0;
  let writtenOk = 0;
  let writtenFailed = 0;

  let batch: EstimateRow[] = [];
  const samples: EstimateRow[] = [];

  while (scanned < ROW_LIMIT) {
    const pageSize = Math.min(CHUNK_SIZE, ROW_LIMIT - scanned);
    let data: ListingRow[] | null;
    try {
      data = await readPage(cursor, pageSize);
    } catch (e) {
      console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
      return;
    }
    if (!data || data.length === 0) {
      console.log('✅ Reached end of table.');
      break;
    }

    for (const r of data) {
      scanned++;
      cursor = r.listing_key;

      const payload = r.full_payload;
      const listPrice = numOrNull(r.list_price);
      if (!payload || !isActive(payload, listPrice)) continue;
      active++;

      const rooms: RoomData[] = Array.isArray(payload['rooms']) ? (payload['rooms'] as RoomData[]) : [];
      const bucketCalibration = lookupCalibration(payload, rooms);

      // GLA / $psf are independent of the AVM gate — compute + store them regardless,
      // so Compare's $/sqft is fixed even when no estimate is available.
      const la = resolveLivingArea(payload, { rooms, bucketCalibration });
      const glaSqft = la.sqft;
      const ppsf = glaSqft && glaSqft > 0 && listPrice ? Math.round((listPrice / glaSqft) * 100) / 100 : null;
      if (glaSqft) withGla++;

      // PureProperty Estimate (AVM), via the shared request-time core.
      // Gate out non-residential sub-types (Parking/Locker/Vacant Land/etc.) — the
      // AVM has no meaningful coefficients there and the noise contaminates Compare.
      let estimated_value: number | null = null;
      let confidence: string | null = null;
      let r2_score: number | null = null;
      let anchor_price: number | null = null;
      let total_adjustment_pct: number | null = null;

      const subType = payload['PropertySubType'];
      const avmEligible = !isNonResidentialSubType(subType);

      const avmInput = avmEligible ? mapListingToAVMInput(payload, { rooms, bucketCalibration }) : null;
      if (avmInput) {
        // getMarketStatic mirrors calculateAVM's resolveModel: native coefficients gate
        // routing; effective (possibly borrowed) coefficients drive comp adjustment.
        const staticData = await getMarketStatic(
          avmInput.cityRegion,
          avmInput.propertySubType,
          avmInput.city,
          avmInput.rawPropertySubType
        );
        // EFFECTIVE coefficients (borrowed when untrained+sibling) drive anchor adjustment.
        const anchor = await fetchAnchor(
          sb,
          avmInput,
          staticData.effectiveCoefficients,
          staticData.basePrice
        );
        // Mirror the request path EXACTLY (shouldEvaluatePeers covers both trained
        // Σβz outliers and untrained-cohort atypical homes) so precomputed Compare
        // values match the listing-page estimate.
        // ROUTING gates on NATIVE coefficients (empty ⟺ untrained → always evaluates peers).
        let peer: AnchorResult | null | undefined;
        if (shouldEvaluatePeers(avmInput, staticData.nativeCoefficients)) {
          peer = await fetchPeerAnchor(sb, avmInput, staticData.effectiveCoefficients);
          // Mark borrowed-basis so peerEstimate caps HIGH the same way as the request path.
          if (peer && staticData.borrowed) peer.basis = 'borrowed';
        }
        const market: AVMMarketData = {
          anchor,
          r2: staticData.r2,
          basePrice: staticData.basePrice,
          // NATIVE coefficients: keep outlierGuard on the untrained→peer path (same as calculateAVM).
          coefficients: staticData.nativeCoefficients,
          peer,
        };
        const est = estimateFromMarketData(avmInput, market);
        if (est.estimatedValue > 0) {
          // Per-row write guards: clamp + validate before any value reaches the
          // upsert. NUMERIC overflow on a single row used to sink the whole 200-row
          // batch (~75 batches × 200 = ~15k phantom "failures"). Now bad math drops
          // the AVM result with a one-line warning and we keep the GLA/ppsf row.
          const clampedAdjPct = Math.max(
            -ADJUSTMENT_PCT_CLAMP,
            Math.min(ADJUSTMENT_PCT_CLAMP, est.totalAdjustmentPct)
          );
          const r2 = est.r2Score;

          if (
            est.estimatedValue <= MAX_ESTIMATED_VALUE &&
            (est.anchorPrice === null || Math.abs(est.anchorPrice) <= MAX_ANCHOR_PRICE) &&
            (r2 === null || Math.abs(r2) <= MAX_R2_SCORE)
          ) {
            estimated_value = est.estimatedValue;
            confidence = est.confidence;
            r2_score = r2;
            anchor_price = est.anchorPrice;
            total_adjustment_pct = Math.round(clampedAdjPct * 100000) / 100000;
            withEstimate++;
          } else {
            console.warn(
              `   ⚠️  ${r.listing_key} AVM result out of column bounds — dropping estimate ` +
                `(est=${est.estimatedValue}, anchor=${est.anchorPrice}, r2=${r2})`
            );
          }
        }
      }

      // Guard GLA / ppsf the same way — a 0.5-sqft listing × $50M list would
      // overflow ppsf NUMERIC(10,2). Drop the offending column rather than the row.
      const safeGla = glaSqft !== null && glaSqft <= MAX_GLA_SQFT ? glaSqft : null;
      const safePpsf = ppsf !== null && ppsf <= MAX_PPSF ? ppsf : null;

      // Skip totally-empty rows (no estimate AND no GLA) — nothing useful to cache.
      if (estimated_value === null && safeGla === null) continue;

      const row: EstimateRow = {
        listing_key: r.listing_key,
        estimated_value,
        confidence,
        r2_score,
        anchor_price,
        total_adjustment_pct,
        gla_sqft: safeGla,
        ppsf: safePpsf,
        computed_at: new Date().toISOString(),
      };
      batch.push(row);
      if (samples.length < 8) samples.push(row);
    }

    console.log(
      `   …scanned ${scanned} (active ${active}, est ${withEstimate}, gla ${withGla}, markets ${marketStaticCache.size}) — last key ${cursor}`
    );

    // Flush as we go so memory stays flat on the full active set.
    if (APPLY && batch.length >= UPSERT_CHUNK * 5) {
      const res = await flush(batch);
      writtenOk += res.ok;
      writtenFailed += res.failed;
      batch = [];
    }

    if (data.length < pageSize) {
      console.log('✅ Last page.');
      break;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n──────── Summary ────────');
  console.log(`Rows scanned:        ${scanned}`);
  console.log(`Active:              ${active}`);
  console.log(`With estimate:       ${withEstimate}`);
  console.log(`With GLA/$psf:       ${withGla}`);
  console.log(`Distinct markets:    ${marketStaticCache.size}`);

  if (samples.length) {
    console.log('\nSample rows:');
    samples.forEach((s) =>
      console.log(
        `   ${s.listing_key}  est=${s.estimated_value ?? '—'} (${s.confidence ?? 'n/a'})  ` +
          `gla=${s.gla_sqft ?? '—'} sqft  $psf=${s.ppsf ?? '—'}`
      )
    );
  }

  if (!APPLY) {
    console.log(`\n(DRY-RUN — ${batch.length} rows accumulated this run. Re-run with --apply to persist.)`);
    return;
  }

  if (batch.length > 0) {
    const res = await flush(batch);
    writtenOk += res.ok;
    writtenFailed += res.failed;
  }
  console.log(`\n   ✅ property_estimates: ${writtenOk} upserted, ${writtenFailed} failed`);
  if (writtenFailed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
