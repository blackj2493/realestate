/**
 * Shadow MLS — Refresh avm_sqft_calibration from active listings' room dimensions.
 *
 * Precomputes the AVM's no-rooms fallback: the median grossed room-sum GLA per
 * (CityRegion, normalized sub-type, LivingAreaRange bucket). When a listing has no
 * usable room dimensions, the AVM looks this up instead of using the naive — often
 * inflated — midpoint of a coarse MLS range bucket.
 *
 * Ground truth = grossed room-sum GLA (the only real size signal; exact
 * BuildingAreaTotal is ~never filled for houses, and raw_vow_sold stores no room
 * data). Source = ACTIVE `listings` whose full_payload.rooms were enriched by the
 * ingester (/PropertyRooms). All deterministic (CLAUDE.md §4); the room-sum logic
 * is shared with the app via src/lib/avm/livingArea.ts so they never drift.
 *
 * IO-FRUGAL (cf. Disk IO Budget incident — memory supabase-io-budget):
 *   - keyset pagination on listing_key (no slow OFFSET)
 *   - in-memory aggregation, then chunked array upserts; inter-chunk delay
 *   - timeout = IO burst-budget exhaustion → exponential backoff + retry
 *   NOTE: full_payload->{rooms,LivingAreaRange,CityRegion} forces a full_payload
 *   DETOAST per row, so pages are kept small and paced.
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-sqft-calibration.ts               # dry-run (no writes)
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-sqft-calibration.ts --limit 5000  # dry-run, first 5000 rows
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-sqft-calibration.ts --apply        # write full table
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import * as https from 'https';
import crossFetch from 'cross-fetch';
import { median, SQFT_MIN, SQFT_MAX } from '@/lib/condo/feeStability';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';
import { roomSumSqft, GLA_GROSSUP } from '@/lib/avm/livingArea';
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
const CHUNK_SIZE = 500; // rows per read page (each detoasts full_payload)
const UPSERT_CHUNK = 200; // rows per array-upsert
const INTER_CHUNK_DELAY_MS = 400;
const MAX_READ_RETRIES = 5;

// Minimum cohort size before a bucket median is trusted / written.
const MIN_SAMPLES = 5;

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ListingRow {
  listing_key: string;
  property_sub_type: string | null;
  rooms: RoomData[] | null; // full_payload->rooms
  lar: string | number | null; // full_payload->LivingAreaRange
  cr: string | null; // full_payload->CityRegion
}

interface BucketAcc {
  cityRegion: string;
  propertySubType: string;
  livingAreaRange: string;
  gla: number[];
}

const buckets = new Map<string, BucketAcc>();

async function readPage(cursor: string, pageSize: number): Promise<ListingRow[] | null> {
  let attempt = 0;
  for (;;) {
    const { data, error } = await sb
      .from('listings')
      .select(
        'listing_key, property_sub_type, rooms:full_payload->rooms, ' +
          'lar:full_payload->LivingAreaRange, cr:full_payload->CityRegion'
      )
      .gt('listing_key', cursor)
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

async function main() {
  console.log('========================================');
  console.log('  Refresh avm_sqft_calibration ← listings.rooms');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`  Row limit: ${ROW_LIMIT}`);
  console.log(`  Gross-up: ×${GLA_GROSSUP}  Min samples: ${MIN_SAMPLES}`);
  console.log('========================================\n');

  let cursor = '';
  let scanned = 0;
  let withRooms = 0;
  let usable = 0;

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

      const bucket = (r.lar === null || r.lar === undefined ? '' : String(r.lar)).trim();
      const cityRegion = (r.cr || '').trim();
      const subType = normalizePropertySubType(r.property_sub_type);
      if (!bucket || !cityRegion || !subType) continue;

      const rs = roomSumSqft(r.rooms);
      if (!rs) continue;
      withRooms++;

      const gla = Math.round(rs.rawSqft * GLA_GROSSUP);
      if (gla < SQFT_MIN || gla > SQFT_MAX) continue;
      usable++;

      const key = `${cityRegion}||${subType}||${bucket}`;
      let b = buckets.get(key);
      if (!b) {
        b = { cityRegion, propertySubType: subType, livingAreaRange: bucket, gla: [] };
        buckets.set(key, b);
      }
      b.gla.push(gla);
    }

    cursor = data[data.length - 1].listing_key;
    console.log(`   …scanned ${scanned} (with rooms ${withRooms}, usable ${usable}) — last key ${cursor}`);

    if (data.length < pageSize) {
      console.log('✅ Last page.');
      break;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  // ── Build upsert rows ────────────────────────────────────────────────────────
  type CalRow = {
    city_region: string;
    property_sub_type: string;
    living_area_range: string;
    median_gla: number;
    sample_count: number;
  };

  const upserts: CalRow[] = [];
  let qualified = 0;
  for (const b of buckets.values()) {
    if (b.gla.length < MIN_SAMPLES) continue;
    qualified++;
    upserts.push({
      city_region: b.cityRegion,
      property_sub_type: b.propertySubType,
      living_area_range: b.livingAreaRange,
      median_gla: Math.round(median(b.gla) * 100) / 100,
      sample_count: b.gla.length,
    });
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n──────── Summary ────────');
  console.log(`Rows scanned:        ${scanned}`);
  console.log(`With usable rooms:   ${usable}`);
  console.log(`Distinct cohorts:    ${buckets.size}`);
  console.log(`Qualified (≥${MIN_SAMPLES}):    ${qualified}`);

  const samples = upserts.slice(0, 8);
  if (samples.length) {
    console.log('\nSample cohorts:');
    samples.forEach((u) =>
      console.log(
        `   ${u.city_region} / ${u.property_sub_type} / ${u.living_area_range}  ` +
          `median GLA=${u.median_gla} sqft  n=${u.sample_count}`
      )
    );
  }

  if (!APPLY) {
    console.log(`\n(DRY-RUN — ${upserts.length} rows would be upserted. Re-run with --apply to persist.)`);
    return;
  }

  if (upserts.length === 0) {
    console.log('\n(No qualified cohorts — nothing to write. Room coverage is still seeding.)');
    return;
  }

  // ── Write (chunked array upserts, IO-paced) ──────────────────────────────────
  console.log(`\n💾 Upserting ${upserts.length} rows to avm_sqft_calibration…`);
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
    const chunk = upserts.slice(i, i + UPSERT_CHUNK);
    const { error } = await sb
      .from('avm_sqft_calibration')
      .upsert(chunk, { onConflict: 'city_region,property_sub_type,living_area_range' });
    if (error) {
      failed += chunk.length;
      console.warn(`   ⚠️  upsert chunk @${i} failed: ${error.message}`);
    } else {
      ok += chunk.length;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }
  console.log(`   ✅ avm_sqft_calibration: ${ok} upserted, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
