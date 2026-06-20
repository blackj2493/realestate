/**
 * Shadow MLS — Backfill flat dimension columns on `listings` (migration 045).
 *
 * region_active_aggregates used to read beds/baths/parking/frontage/basement out of the
 * heavily-TOASTed listings.full_payload (a ~17s detoast for a filtered "Toronto" query).
 * Migration 045 added flat columns; this back-fills them on every existing row so
 * migration 046 can read them WITHOUT touching full_payload. New/updated rows already get
 * the flats from the daily ETL (transformer.ts + sync.ts). Deterministic; no LLM (§4),
 * no schema change (§12 — listings is the active store, fully writable, unlike raw_vow_sold).
 *
 * basement_tier uses the SAME shared deriver as the sold side (deriveBasementTier, 1-9), so
 * the active + sold aggregate basement bands are identical.
 *
 * IO-FRUGAL (cf. supabase-io-budget memory):
 *   - reads ONLY the five JSONB sub-keys it needs (network-frugal; the server still detoasts
 *     to read them, but batching + delays pace it instead of one 5-min full-table statement)
 *   - keyset pagination on listing_key (no slow OFFSET on a 136k table)
 *   - tiny writes (5 columns) via per-row UPDATE by PK, bounded concurrency, inter-chunk delay
 *   - resumable: persists a cursor so a crash / --limit run continues where it left off
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/admin/backfill-listings-dimensions.ts                 # dry-run (no writes)
 *   npx tsx --env-file=.env scripts/admin/backfill-listings-dimensions.ts --limit 1000    # dry-run, first 1000
 *   npx tsx --env-file=.env scripts/admin/backfill-listings-dimensions.ts --apply         # write, full table
 *   npx tsx --env-file=.env scripts/admin/backfill-listings-dimensions.ts --apply --resume # continue from cursor
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import crossFetch from 'cross-fetch';
import { deriveBasementTier } from '@/lib/avm/conditionScoring';

// Patch global fetch with a TLS-relaxed agent for the Supabase client.
const agent = new https.Agent({ rejectUnauthorized: false });
(global as unknown as { fetch: typeof fetch }).fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
  // @ts-expect-error agent is a node-fetch option, not standard
  crossFetch(url, { ...init, agent })) as typeof fetch;

// ── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const ROW_LIMIT = limitArg
  ? parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1], 10)
  : Infinity;

// ── IO pacing (deliberately gentle) ──────────────────────────────────────────
const CHUNK_SIZE = 500;
const UPDATE_CONCURRENCY = 8;
const INTER_CHUNK_DELAY_MS = 200;

const CURSOR_FILE = path.join(process.cwd(), 'scripts', 'admin', '.backfill-listings-dims-cursor.json');

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

/** Coerce a raw RESO scalar to a finite number, else 0 — matches transformer.numOr0. */
function numOr0(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface DimRow {
  listing_key: string;
  bedroomsTotal: unknown;
  bathroomsTotalInteger: unknown;
  parkingTotal: unknown;
  lotWidth: unknown;
  basement: unknown;
}

function computeDims(r: DimRow) {
  return {
    bedrooms_total: numOr0(r.bedroomsTotal),
    bathrooms_total_integer: numOr0(r.bathroomsTotalInteger),
    parking_total: numOr0(r.parkingTotal),
    lot_width: numOr0(r.lotWidth),
    // deriveBasementTier reads payload['Basement']; reconstruct the minimal shape.
    basement_tier: deriveBasementTier({ Basement: r.basement } as Record<string, unknown>),
  };
}

type DimUpdate = { listing_key: string } & ReturnType<typeof computeDims>;

function readCursor(): string {
  if (RESUME && fs.existsSync(CURSOR_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8')).cursor || '';
    } catch {
      return '';
    }
  }
  return '';
}

function writeCursor(cursor: string, processed: number) {
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor, processed, ts: new Date().toISOString() }, null, 2));
}

// Bounded-concurrency runner for the per-row UPDATEs (by listing_key).
async function applyUpdates(updates: DimUpdate[]): Promise<{ ok: number; failed: number; errors: string[] }> {
  const result = { ok: 0, failed: 0, errors: [] as string[] };
  let idx = 0;
  async function worker() {
    while (idx < updates.length) {
      const u = updates[idx++];
      const { listing_key, ...cols } = u;
      const { error } = await sb.from('listings').update(cols).eq('listing_key', listing_key);
      if (error) {
        result.failed++;
        if (result.errors.length < 5) result.errors.push(`${listing_key}: ${error.message}`);
      } else {
        result.ok++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPDATE_CONCURRENCY, updates.length) }, worker));
  return result;
}

async function main() {
  console.log('========================================');
  console.log('  Backfill listings dimension columns');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`  Row limit: ${ROW_LIMIT}`);
  if (RESUME) console.log('  Resuming from saved cursor');
  console.log('========================================\n');

  let cursor = readCursor();
  if (cursor) console.log(`▶️  Starting after listing_key > "${cursor}"\n`);

  let processed = 0;
  let updatedOk = 0;
  let updateFailed = 0;
  const dist = { beds: new Map<number, number>(), basement: new Map<number, number>() };
  const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) || 0) + 1);
  const samples: string[] = [];

  while (processed < ROW_LIMIT) {
    const pageSize = Math.min(CHUNK_SIZE, ROW_LIMIT - processed);
    const { data, error } = await sb
      .from('listings')
      .select(
        'listing_key, ' +
          'bedroomsTotal:full_payload->BedroomsTotal, ' +
          'bathroomsTotalInteger:full_payload->BathroomsTotalInteger, ' +
          'parkingTotal:full_payload->ParkingTotal, ' +
          'lotWidth:full_payload->LotWidth, ' +
          'basement:full_payload->Basement'
      )
      .gt('listing_key', cursor)
      .order('listing_key', { ascending: true })
      .limit(pageSize);

    if (error) {
      console.error(`❌ Read failed at cursor "${cursor}": ${error.message}`);
      process.exitCode = 1;
      break;
    }
    if (!data || data.length === 0) {
      console.log('✅ Reached end of table.');
      break;
    }

    const rows = data as unknown as DimRow[];
    const updates: DimUpdate[] = rows.map((r) => {
      const dims = computeDims(r);
      bump(dist.beds, dims.bedrooms_total);
      bump(dist.basement, dims.basement_tier);
      if (samples.length < 8) {
        samples.push(
          `   ${r.listing_key}  bd=${dims.bedrooms_total} ba=${dims.bathrooms_total_integer} pk=${dims.parking_total} lw=${dims.lot_width} bsmt=${dims.basement_tier}`
        );
      }
      return { listing_key: r.listing_key, ...dims };
    });

    if (APPLY) {
      const res = await applyUpdates(updates);
      updatedOk += res.ok;
      updateFailed += res.failed;
      if (res.errors.length) res.errors.forEach((e) => console.warn(`   ⚠️  ${e}`));
    }

    processed += rows.length;
    cursor = rows[rows.length - 1].listing_key;
    if (APPLY) writeCursor(cursor, processed);

    console.log(
      `   …${processed} processed${APPLY ? ` (${updatedOk} ok, ${updateFailed} failed)` : ''} — last key ${cursor}`
    );

    if (rows.length < pageSize) {
      console.log('✅ Last page.');
      break;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  const fmt = (m: Map<number, number>) =>
    [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join('  ');

  console.log('\n──────── Summary ────────');
  console.log(`Processed:        ${processed}`);
  if (APPLY) console.log(`Updated:          ${updatedOk} ok, ${updateFailed} failed`);
  console.log(`bedrooms_total →  ${fmt(dist.beds)}`);
  console.log(`basement_tier →   ${fmt(dist.basement)}`);
  console.log('\nSample rows:');
  samples.forEach((s) => console.log(s));
  if (!APPLY) console.log('\n(DRY-RUN — no rows written. Re-run with --apply to persist.)');
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
