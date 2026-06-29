/**
 * Shadow MLS — Backfill LivingAreaRange onto the live `properties` Typesense collection.
 *
 * WHY: transformer.ts now writes LivingAreaRange (TRREB sqft band, e.g. "2500-3000")
 * as stored-only display cargo — the same pattern as BuildingAreaTotal: undeclared in
 * the schema, so returned by Typesense but not filter/sortable. BuildingAreaTotal is
 * ~never filled for houses, so LivingAreaRange is the sqft fallback the headline /
 * quick-look / dashboard rows read. But the daily sync (ingester.ts) is DELTA-only
 * (ModificationTimestamp gt lastSync), so existing docs won't carry LivingAreaRange
 * until each listing next changes upstream. This one-time backfill populates every
 * active doc now. New/changed listings get it automatically from the next delta sync.
 *
 * SOURCE: listings.full_payload->>LivingAreaRange, PRE-FILTERED to rows where the cheap
 * scalar `living_area_range` (int) column is non-null — so only banded listings detoast
 * the full_payload blob. (A row with a non-null int band always has a string band.)
 * SINK:   Typesense documents().import(action:'update') — partial update. Docs that are
 *         not in the index (e.g. delisted) simply fail that row (non-fatal, reported).
 *
 * IO-FRUGAL (memory supabase-io-budget): keyset pagination on listing_key (no OFFSET),
 * small pages, inter-chunk delay, retry+backoff on statement timeout. This is a ONE-TIME
 * read of a fraction of what refresh-condo-fee-stats detoasts every single day.
 *
 * Idempotent: re-running re-writes the same values. Typesense ONLY writes (no Supabase writes).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/admin/backfill-living-area-range.ts            # dry-run (counts + sample, no writes)
 *   npx tsx --env-file=.env scripts/admin/backfill-living-area-range.ts --apply    # write to Typesense
 *   npx tsx --env-file=.env scripts/admin/backfill-living-area-range.ts --apply --limit 2000
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import Typesense from 'typesense';
// Reuse the app's service-role client: it wraps Node's NATIVE (undici) fetch, NOT
// cross-fetch. cross-fetch → node-fetch throws "Premature close" when Supabase
// truncates the REST body mid-stream (the bug that killed the daily ETL; see
// src/lib/supabase/client.ts). undici tolerates it.
import { getServiceRoleClient } from '@/lib/supabase/client';

// ── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const ROW_LIMIT = limitArg
  ? parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1], 10)
  : Infinity;

// ── IO pacing (gentle; mirrors refresh-condo-fee-stats.ts) ─────────────────────
const PAGE_SIZE = 500; // rows per read page (each detoasts full_payload for the JSON sub-key)
const TS_CHUNK = 1000; // docs per Typesense import(update) — smaller → more frequent flush, less idle socket
const INTER_PAGE_DELAY_MS = 400; // let the Disk IO burst budget refill between pages
const MAX_READ_RETRIES = 5;
const MAX_WRITE_RETRIES = 5;

// ── Typesense (admin) — same host the app/client.ts uses; ADMIN key required to write ──
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const TS_KEY = (process.env.TYPESENSE_ADMIN_API_KEY || '').trim();

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!TS_KEY) {
  console.error('❌ Missing TYPESENSE_ADMIN_API_KEY (search-only key cannot write)');
  process.exit(1);
}

const sb = getServiceRoleClient();

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: TS_KEY,
  connectionTimeoutSeconds: 120,
  // Between flushes the socket sits idle during the multi-second Supabase detoast reads;
  // Typesense Cloud's LB resets idle keep-alive sockets → ECONNRESET on the next import.
  // A longer retry interval lets the client open a fresh connection instead of reusing the
  // dead one (the default 0.1s retry just hits the same socket again).
  numRetries: 4,
  retryIntervalSeconds: 3,
  healthcheckIntervalSeconds: 2,
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Row {
  listing_key: string;
  band: string | null; // full_payload->>LivingAreaRange
}

/** One keyset page of banded listings, with retry + exponential backoff on IO timeout. */
async function readPage(cursor: string, pageSize: number): Promise<Row[]> {
  let attempt = 0;
  for (;;) {
    const { data, error } = await sb
      .from('listings')
      // `listings` has no flat band column (living_area_range is on raw_vow_sold, not here),
      // so the band only lives in full_payload — extract just that JSON sub-key as text.
      .select('listing_key, band:full_payload->>LivingAreaRange')
      .gt('listing_key', cursor)
      .order('listing_key', { ascending: true })
      .limit(pageSize);

    if (!error) return (data as unknown as Row[] | null) ?? [];

    attempt++;
    if (attempt > MAX_READ_RETRIES) {
      throw new Error(`read failed at cursor "${cursor}" after ${MAX_READ_RETRIES} retries: ${error.message}`);
    }
    const backoff = Math.min(30000, 3000 * 2 ** (attempt - 1)); // 3s,6s,12s,24s,30s
    console.warn(`   ⏳ Read errored at "${cursor}" (attempt ${attempt}/${MAX_READ_RETRIES}): ${error.message} — backing off ${backoff}ms…`);
    await sleep(backoff);
  }
}

/** import() with retry+backoff — survives idle-socket ECONNRESET / transient resets. */
async function importWithRetry(ndjson: string): Promise<string> {
  let attempt = 0;
  for (;;) {
    try {
      return (await ts.collections(COLLECTION).documents().import(ndjson, { action: 'update' })) as unknown as string;
    } catch (e: unknown) {
      attempt++;
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt > MAX_WRITE_RETRIES) throw new Error(`Typesense import failed after ${MAX_WRITE_RETRIES} retries: ${msg}`);
      const backoff = Math.min(30000, 2000 * 2 ** (attempt - 1)); // 2s,4s,8s,16s,30s
      console.warn(`   ⏳ Typesense import failed (attempt ${attempt}/${MAX_WRITE_RETRIES}): ${msg} — retrying in ${backoff}ms…`);
      await sleep(backoff);
    }
  }
}

/** Push a chunk of {id, LivingAreaRange} partial updates; returns [ok, failed, notInIndex]. */
async function pushChunk(updates: Array<{ id: string; LivingAreaRange: string }>): Promise<[number, number, number]> {
  const ndjson = updates.map((u) => JSON.stringify(u)).join('\n');
  const res = await importWithRetry(ndjson);
  let ok = 0;
  let failed = 0;
  let notInIndex = 0;
  for (const line of res.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { success: boolean; error?: string };
      if (r.success) ok++;
      else if (/find a document with id/i.test(r.error || '')) notInIndex++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return [ok, failed, notInIndex];
}

async function dryRun() {
  const probe = await sb.from('listings').select('listing_key', { count: 'exact', head: true });
  console.log(`Total listings: ${probe.error ? 'ERR' : (probe.count ?? 0).toLocaleString()}`);

  // First keyset page WITH the detoasted band — proves the full_payload->>LivingAreaRange
  // JSON path resolves and shows how many rows actually carry a band (PK-ordered, LIMIT 12).
  const sample = await readPage('', 12);
  const withBand = sample.filter((r) => (r.band ?? '').trim());
  console.log(`\nSample (first ${sample.length} listings by listing_key):`);
  for (const r of sample) console.log(`   ${r.listing_key}  →  LivingAreaRange = ${JSON.stringify(r.band)}`);
  console.log(`\n${withBand.length}/${sample.length} of the sample carry a non-empty band.`);
  console.log(`--apply will scan all ${(probe.count ?? 0).toLocaleString()} listings (keyset by listing_key), detoasting`);
  console.log('full_payload->>LivingAreaRange per row and writing the non-empty ones to Typesense.');
  console.log('\nDRY-RUN — no writes. Re-run with --apply to backfill Typesense.');
}

async function apply() {
  // PHASE 1 — read all bands from Supabase (keyset-paginated, IO-paced). We buffer the
  // small {id, band} pairs in memory (~5MB for 174k) so PHASE 2 can write to Typesense
  // back-to-back, keeping the keep-alive socket warm (no idle ECONNRESET between writes).
  console.log('Phase 1/2 — reading bands from Supabase (keyset by listing_key)…\n');
  const updates: Array<{ id: string; LivingAreaRange: string }> = [];
  let cursor = '';
  let scanned = 0;
  while (scanned < ROW_LIMIT) {
    const pageSize = Math.min(PAGE_SIZE, ROW_LIMIT - scanned);
    const rows = await readPage(cursor, pageSize);
    if (rows.length === 0) break;
    for (const r of rows) {
      scanned++;
      const band = (r.band ?? '').trim();
      if (band) updates.push({ id: r.listing_key, LivingAreaRange: band });
    }
    cursor = rows[rows.length - 1].listing_key;
    console.log(`   …read ${scanned.toLocaleString()} (banded ${updates.length.toLocaleString()}) — last key ${cursor}`);
    if (rows.length < pageSize) break;
    await sleep(INTER_PAGE_DELAY_MS);
  }
  console.log(`\nRead complete: ${scanned.toLocaleString()} scanned, ${updates.length.toLocaleString()} carry a band.`);

  // PHASE 2 — write to Typesense back-to-back (chunked partial updates, write-retry per chunk).
  console.log(`\nPhase 2/2 — writing ${updates.length.toLocaleString()} updates to Typesense (chunks of ${TS_CHUNK})…`);
  let ok = 0;
  let failed = 0;
  let notInIndex = 0;
  for (let i = 0; i < updates.length; i += TS_CHUNK) {
    const [o, f, n] = await pushChunk(updates.slice(i, i + TS_CHUNK));
    ok += o;
    failed += f;
    notInIndex += n;
    console.log(`   …wrote ${Math.min(i + TS_CHUNK, updates.length).toLocaleString()}/${updates.length.toLocaleString()} (indexed ${ok.toLocaleString()}, not-in-index ${notInIndex.toLocaleString()}, failed ${failed.toLocaleString()})`);
  }

  console.log('\n──────── Summary ────────');
  console.log(`Scanned:              ${scanned.toLocaleString()}`);
  console.log(`Had a band string:    ${updates.length.toLocaleString()}`);
  console.log(`✅ Indexed (updated): ${ok.toLocaleString()}`);
  console.log(`↷  Not in index:      ${notInIndex.toLocaleString()} (delisted / not active — expected, harmless)`);
  console.log(`❌ Failed:            ${failed.toLocaleString()}`);
  if (failed > 0) process.exitCode = 1;
}

async function main() {
  console.log(`\n🏷️  Backfill LivingAreaRange → Typesense  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`   Row limit: ${ROW_LIMIT}`);
  console.log('='.repeat(56));
  if (APPLY) await apply();
  else await dryRun();
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
