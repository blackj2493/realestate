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
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as https from 'https';
import crossFetch from 'cross-fetch';
import { mapListingToAVMInput } from '@/lib/avm/mapListingToAVMInput';
import { resolveLivingArea, type BucketCalibration } from '@/lib/avm/livingArea';
import { estimateFromMarketData, type AVMMarketData } from '@/lib/avm/calculator';
import { fetchAnchor } from '@/lib/avm/anchorService';
import { fetchAuditInfo } from '@/lib/avm/auditService';
import { fetchCoefficients, type CoefficientRow } from '@/lib/avm/matrixService';
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
// The new anchor pipeline is per-listing in the sense that it depends on the
// listing's (cityRegion, sub_type, City), but the (audit, coefficients) lookup
// is still per-market and stable across listings in the same cohort — memoize
// those, and call fetchAnchor per listing using the cached pair.
interface MarketStaticData {
  r2: number | null;
  basePrice: number | null;
  coefficients: CoefficientRow[];
}
const marketStaticCache = new Map<string, MarketStaticData>();

async function getMarketStatic(
  cityRegion: string,
  normalizedType: string
): Promise<MarketStaticData> {
  const key = `${cityRegion.toLowerCase()}|${normalizedType.toLowerCase()}`;
  const cached = marketStaticCache.get(key);
  if (cached) return cached;
  const [audit, coefficients] = await Promise.all([
    fetchAuditInfo(sb, cityRegion, normalizedType),
    fetchCoefficients(sb, cityRegion, normalizedType),
  ]);
  const market: MarketStaticData = { r2: audit.r2, basePrice: audit.basePrice, coefficients };
  marketStaticCache.set(key, market);
  return market;
}

async function readPage(cursor: string, pageSize: number): Promise<ListingRow[] | null> {
  let attempt = 0;
  for (;;) {
    const { data, error } = await sb
      .from('listings')
      .select('listing_key, list_price, full_payload')
      .gt('listing_key', cursor)
      .gte('list_price', PRICE_FLOOR)
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
      let estimated_value: number | null = null;
      let confidence: string | null = null;
      let r2_score: number | null = null;
      let anchor_price: number | null = null;
      let total_adjustment_pct: number | null = null;

      const avmInput = mapListingToAVMInput(payload, { rooms, bucketCalibration });
      if (avmInput) {
        const staticData = await getMarketStatic(avmInput.cityRegion, avmInput.propertySubType);
        const anchor = await fetchAnchor(
          sb,
          avmInput,
          staticData.coefficients,
          staticData.basePrice
        );
        const market: AVMMarketData = {
          anchor,
          r2: staticData.r2,
          basePrice: staticData.basePrice,
          coefficients: staticData.coefficients,
        };
        const est = estimateFromMarketData(avmInput, market);
        if (est.estimatedValue > 0) {
          estimated_value = est.estimatedValue;
          confidence = est.confidence;
          r2_score = est.r2Score;
          anchor_price = est.anchorPrice;
          total_adjustment_pct = Math.round(est.totalAdjustmentPct * 100000) / 100000;
          withEstimate++;
        }
      }

      // Skip totally-empty rows (no estimate AND no GLA) — nothing useful to cache.
      if (estimated_value === null && glaSqft === null) continue;

      const row: EstimateRow = {
        listing_key: r.listing_key,
        estimated_value,
        confidence,
        r2_score,
        anchor_price,
        total_adjustment_pct,
        gla_sqft: glaSqft,
        ppsf,
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
