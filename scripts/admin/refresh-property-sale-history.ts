/**
 * Shadow MLS — Refresh property_sale_history from raw_vow_sold.
 *
 * Precomputes the prior-sale ledger the listing page reads for "Sale History" and
 * the "Price Timeline" sold markers: one row per property_hash, with a newest-first
 * JSONB array of every sold campaign for that physical address.
 *
 * Reads raw_vow_sold READ-ONLY (CLAUDE.md §12 — never alter it) and writes the
 * SEPARATE property_sale_history table. Deterministic only (CLAUDE.md §4) — no LLM.
 *
 * IO-FRUGAL (cf. Disk IO Budget incident — memory supabase-io-budget):
 *   - reads only the few small columns it needs, never the full raw_payload
 *   - keyset pagination on listing_key (no slow OFFSET on a 217k table)
 *   - in-memory grouping, then chunked array upserts; inter-chunk delay to let IO refill
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-property-sale-history.ts                 # dry-run (no writes)
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-property-sale-history.ts --limit 5000    # dry-run, first 5000 rows
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-property-sale-history.ts --apply         # write full table
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import * as https from 'https';
import crossFetch from 'cross-fetch';
import { generatePropertyHash } from '@/lib/typesense/TemporalDistressEngine';

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
const CHUNK_SIZE = 1000; // light rows per read page (few small columns each)
const UPSERT_CHUNK = 200; // rows per array-upsert
const INTER_CHUNK_DELAY_MS = 200;
const MAX_EVENTS_PER_PROPERTY = 50; // bound JSONB row size for pathological addresses

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

// Raw row shape from the projected select. NOTE: we do NOT trust the stored
// property_hash — most of the historical archive was bulk-loaded with it set to an
// un-hashed address string that never matches listings' SHA-256. We recompute the
// hash from the address components with the SAME generatePropertyHash() the listings
// table uses, so the precompute keys join correctly at read time.
interface SoldRow {
  listing_key: string;
  list_price: number | string | null;
  close_price: number | string | null;
  purchase_contract_date: string | null;
  close_date: string | null;
  property_sub_type: string | null;
  StreetNumber: unknown;
  StreetName: unknown;
  City: unknown;
  UnitNumber: unknown;
  UnparsedAddress: unknown;
}

// One prior sale campaign as stored in sale_events[].
interface SaleEvent {
  listing_key: string;
  list_price: number | null;
  close_price: number | null;
  contract_date: string | null;
  close_date: string | null;
  sub_type: string | null;
}

// In-memory accumulator: property_hash -> events.
const byHash = new Map<string, SaleEvent[]>();

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// Canonical sale date = PurchaseContractDate (the "Sold Date"), fall back to CloseDate.
function effectiveDate(e: { contract_date: string | null; close_date: string | null }): string | null {
  return e.contract_date || e.close_date || null;
}

function dateMs(d: string | null): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

async function main() {
  console.log('========================================');
  console.log('  Refresh property_sale_history ← raw_vow_sold');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`  Row limit: ${ROW_LIMIT}`);
  console.log('========================================\n');

  let cursor = '';
  let scanned = 0;
  let usable = 0;
  let skippedBadHash = 0;

  while (scanned < ROW_LIMIT) {
    const pageSize = Math.min(CHUNK_SIZE, ROW_LIMIT - scanned);
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select(
        'listing_key, list_price, close_price, purchase_contract_date, close_date, property_sub_type, ' +
          'StreetNumber:raw_payload->StreetNumber, StreetName:raw_payload->StreetName, ' +
          'City:raw_payload->City, UnitNumber:raw_payload->UnitNumber, ' +
          'UnparsedAddress:raw_payload->UnparsedAddress'
      )
      .gt('listing_key', cursor)
      .order('listing_key', { ascending: true })
      .limit(pageSize);

    if (error) {
      console.error(`❌ Read failed at cursor "${cursor}": ${error.message}`);
      process.exitCode = 1;
      return;
    }
    if (!data || data.length === 0) {
      console.log('✅ Reached end of table.');
      break;
    }

    const rows = data as unknown as SoldRow[];
    for (const r of rows) {
      scanned++;

      // Recompute the canonical hash from address components (same fn as listings),
      // because the stored property_hash is an un-hashed address string for ~all rows.
      const hasAddr = (r.StreetNumber && r.StreetName) || r.UnparsedAddress;
      if (!hasAddr) {
        skippedBadHash++;
        continue;
      }
      const hash = generatePropertyHash({
        StreetNumber: r.StreetNumber,
        StreetName: r.StreetName,
        City: r.City,
        UnitNumber: r.UnitNumber,
        UnparsedAddress: r.UnparsedAddress,
      });
      if (!hash) continue;

      const closePrice = numOrNull(r.close_price);
      const event: SaleEvent = {
        listing_key: r.listing_key,
        list_price: numOrNull(r.list_price),
        // close_price is NOT NULL in raw_vow_sold (defaults to 0 when absent) — a 0
        // here means "no real sold price", so normalize it to null for the ledger.
        close_price: closePrice && closePrice > 0 ? closePrice : null,
        contract_date: r.purchase_contract_date || null,
        close_date: r.close_date || null,
        sub_type: r.property_sub_type || null,
      };

      // A ledger event needs a date to be meaningful.
      if (!effectiveDate(event)) continue;
      usable++;

      const existing = byHash.get(hash);
      if (existing) existing.push(event);
      else byHash.set(hash, [event]);
    }

    cursor = rows[rows.length - 1].listing_key;
    console.log(`   …scanned ${scanned} (usable ${usable}, properties ${byHash.size}) — last key ${cursor}`);

    if (rows.length < pageSize) {
      console.log('✅ Last page.');
      break;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  // ── Build upsert rows ────────────────────────────────────────────────────────
  type HistoryRow = {
    property_hash: string;
    sale_events: SaleEvent[];
    sale_count: number;
    last_close_price: number | null;
    last_close_date: string | null;
    first_seen_date: string | null;
  };

  const upserts: HistoryRow[] = [];
  let multiSale = 0;

  for (const [hash, events] of byHash.entries()) {
    // Newest-first by effective (contract→close) date.
    events.sort((a, b) => dateMs(effectiveDate(b)) - dateMs(effectiveDate(a)));
    const trimmed = events.slice(0, MAX_EVENTS_PER_PROPERTY);

    const newest = trimmed[0];
    const oldest = events[events.length - 1];
    if (events.length > 1) multiSale++;

    upserts.push({
      property_hash: hash,
      sale_events: trimmed,
      sale_count: events.length,
      last_close_price: newest.close_price,
      last_close_date: effectiveDate(newest),
      first_seen_date: effectiveDate(oldest),
    });
  }

  // ── Summary (verify-first diagnostic) ─────────────────────────────────────────
  console.log('\n──────── Summary ────────');
  console.log(`Rows scanned:        ${scanned}`);
  console.log(`Skipped (no address): ${skippedBadHash}`);
  console.log(`Usable sale events:  ${usable}`);
  console.log(`Distinct properties: ${byHash.size}`);
  console.log(`Multi-sale (>1):     ${multiSale}`);

  const samples = upserts.filter((u) => u.sale_count > 1).slice(0, 5);
  if (samples.length) {
    console.log('\nSample multi-sale properties:');
    samples.forEach((u) =>
      console.log(
        `   ${u.property_hash.slice(0, 12)}…  ${u.sale_count} sales  ` +
          `last=${u.last_close_date} ($${u.last_close_price ?? '—'})  first=${u.first_seen_date}`
      )
    );
  }

  if (!APPLY) {
    console.log(`\n(DRY-RUN — ${upserts.length} rows would be upserted. Re-run with --apply to persist.)`);
    return;
  }

  // ── Write (chunked array upserts, IO-paced) ──────────────────────────────────
  console.log(`\n💾 Upserting ${upserts.length} rows to property_sale_history…`);
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
    const chunk = upserts.slice(i, i + UPSERT_CHUNK);
    const { error } = await sb
      .from('property_sale_history')
      .upsert(chunk, { onConflict: 'property_hash' });
    if (error) {
      failed += chunk.length;
      console.warn(`   ⚠️  upsert chunk @${i} failed: ${error.message}`);
    } else {
      ok += chunk.length;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }
  console.log(`   ✅ property_sale_history: ${ok} upserted, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
