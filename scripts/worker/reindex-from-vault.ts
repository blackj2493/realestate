/**
 * Shadow MLS - Vault Re-Indexer (Memory-Safe Edition)
 *
 * Re-indexes ACTIVE listings from Supabase Vault (listings table) into Typesense.
 * Uses cursor-based pagination to handle 90k+ records without V8 OOM crashes.
 *
 * Builds each document via the SAME transformListing() the daily sync uses, so the
 * full Typesense schema (all required fields + financial metrics) is always
 * satisfied. Non-active listings (Sold/Closed/Leased/etc.) are skipped — they are
 * never indexed (Supabase serves sold comps; indexing them caused Typesense OOM).
 *
 * WARNING: Uses SUPABASE_SERVICE_ROLE_KEY - NEVER expose to frontend!
 *
 * Run: npx tsx --env-file=.env scripts/worker/reindex-from-vault.ts
 */

// MUST set TLS env var BEFORE importing supabase client
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Typesense from 'typesense';
import * as https from 'https';
import * as fs from 'fs';

// Import cross-fetch
import crossFetch from 'cross-fetch';

// Patch global fetch with TLS disabled agent for Supabase client
const agent = new https.Agent({ rejectUnauthorized: false });
const patchedFetch: typeof fetch = (url, init) => {
  // Hard 45s per-request cap. On the intermittently-throttled Supabase instance a
  // hung connection otherwise blocks the entire run forever (observed twice). An
  // abort surfaces as a fetch error → fetchChunk retries it (isThrottleError matches
  // 'abort'); per-record AVM aborts are caught and counted as failed, not hung.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  if (init?.signal) init.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  return crossFetch(url, {
    ...init,
    // @ts-ignore - agent is not a standard option
    agent,
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
};
(global as unknown as { fetch: typeof fetch }).fetch = patchedFetch;

// ============================================================================
// Configuration
// ============================================================================

// ── Gentle / IO-frugal mode ─────────────────────────────────────────────────
// This is a one-off bulk job competing for a finite Supabase Disk IO burst
// budget. A previous aggressive run (CHUNK_SIZE=500, concurrency=25) drained the
// budget and throttled the whole instance to its baseline IO rate, after which
// even `SELECT id LIMIT 1` took ~11s and every fetch hit the statement timeout.
// These settings keep the sustained read rate low enough that the budget refills
// roughly as fast as we spend it, so the run can complete without re-throttling.
const CHUNK_SIZE = 100;            // Rows per Supabase page. Small so each fetch
                                   // (heavy full_payload JSONB) clears the
                                   // statement timeout even near baseline IO.
const TRANSFORM_CONCURRENCY = 4;   // Concurrent transformListing() calls per chunk.
                                   // Each does ~3-4 Supabase AVM queries, so this
                                   // caps instantaneous reads at ~12-16 — low on
                                   // purpose (cf. 2026-05-19 Disk IO Budget incident).
const BASE_BATCH_DELAY_MS = 750;   // Idle gap between batches to let IO budget refill.
const FETCH_MAX_RETRIES = 8;       // Per-chunk fetch retries before aborting.
const FETCH_BACKOFF_BASE_MS = 8000;  // First backoff after a timeout; doubles each retry.
const FETCH_BACKOFF_CAP_MS = 90000;  // Max single backoff (90s).
const CHECKPOINT_FILE = 'scripts/.reindex-cursor'; // Last indexed id, for resume.
const TYPESENSE_COLLECTION = 'properties';
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;

// Listings no longer available are never indexed (mirror sync.ts:NON_ACTIVE_STATUSES).
const NON_ACTIVE_STATUSES = new Set([
  'sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended',
]);

// Environment variables
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivixhnwzfrdkiq.supabase.co').trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TYPESENSE_ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY || 'B6u0qIHDNhXZH8PMw0E6J5tB5aWvLXCn';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set - cannot proceed without admin access to vault');
  process.exit(1);
}

// Warn about TLS setting if needed
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.log('⚠️  TLS certificate verification disabled (corporate proxy mode)');
}

// ============================================================================
// Types
// ============================================================================

interface ListingRecord {
  id: string; // UUID — the listings PK (NOT an integer)
  listing_key: string;
  full_payload: Record<string, unknown>;
  property_hash: string | null;
}

interface TransformResult {
  success: number;
  failed: number;
  skipped: number;  // non-active listings excluded from the index
  failedIds: string[];
  errors: string[];
}

// ============================================================================
// Clients
// ============================================================================

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const typesense = new Typesense.Client({
  nodes: [{
    host: TYPESENSE_HOST,
    port: TYPESENSE_PORT,
    protocol: 'https'
  }],
  apiKey: TYPESENSE_ADMIN_KEY,
  connectionTimeoutSeconds: 30
});

// ============================================================================
// Shared transformer (dynamic import — keeps the TLS/fetch patch above in
// effect before transformer.ts pulls in the Supabase-backed AVM services).
// ============================================================================

type TransformListing = typeof import('./transformer')['transformListing'];
let transformListing: TransformListing | null = null;

async function ensureTransformerLoaded(): Promise<void> {
  if (transformListing) return;
  const mod = await import('./transformer');
  transformListing = mod.transformListing;
  console.log('[Reindex] Shared transformListing() loaded');
}

// ============================================================================
// Postal Code Lookup (imported from master library)
// ============================================================================

let postalCodesLoaded = false;

async function ensurePostalCodesLoaded(): Promise<void> {
  if (postalCodesLoaded) return;

  try {
    const postalCodes = await import('../../src/lib/postalCodes');
    postalCodes.loadPostalCodes();
    postalCodesLoaded = true;
    console.log('[Reindex] Master postal code library loaded');
  } catch (err) {
    console.error('[Reindex] Failed to load postal codes:', err);
    throw err;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Status precedence mirrors transformer.ts (Status → MlsStatus → StandardStatus). */
function isActiveListing(raw: Record<string, unknown>): boolean {
  const status = String(
    (raw.Status as string) || (raw.MlsStatus as string) || (raw.StandardStatus as string) || ''
  ).trim().toLowerCase();
  return !NON_ACTIVE_STATUSES.has(status);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** A throttled instance surfaces as a statement timeout, or a masked empty error. */
function isThrottleError(msg: string): boolean {
  const m = (msg || '').toLowerCase();
  return (
    m === '' ||
    m.includes('statement timeout') ||
    m.includes('canceling statement') ||
    m.includes('timeout') ||
    m.includes('fetch failed') ||
    m.includes('abort')
  );
}

/** Run an async mapper over items with a bounded concurrency pool. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// ============================================================================
// Process a batch with robust error handling
// ============================================================================

async function processBatch(records: ListingRecord[]): Promise<TransformResult> {
  const result: TransformResult = {
    success: 0,
    failed: 0,
    skipped: 0,
    failedIds: [],
    errors: []
  };

  // Active-only filter BEFORE the expensive transform — avoids running AVM
  // lookups on Sold/Closed rows we would discard anyway.
  const active = records.filter(r => isActiveListing(r.full_payload));
  result.skipped = records.length - active.length;

  if (active.length === 0) {
    return result;
  }

  // Transform with bounded concurrency. Reuses the canonical transformListing()
  // (full schema), then appends the temporal fields it does not set.
  const documents: Record<string, unknown>[] = [];

  await mapWithConcurrency(active, TRANSFORM_CONCURRENCY, async (record) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = record.full_payload as any;
      const { typesensePayload } = await transformListing!(raw);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc: any = { ...typesensePayload };
      // transformListing sets PropertyHash/TrueDom/IsStale but NOT TotalPriceDrop
      // (a required int32). Prefer values already persisted in the vault for fidelity.
      doc.TotalPriceDrop = (raw.total_price_drop ?? doc.TotalPriceDrop ?? 0);
      doc.PropertyHash = record.property_hash || doc.PropertyHash || '';
      doc.TrueDom = (raw.true_dom ?? doc.TrueDom ?? 0);

      documents.push(doc);
    } catch (err) {
      result.failed++;
      result.failedIds.push(record.listing_key);
      result.errors.push(
        `Transform failed ${record.listing_key}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  // Push to Typesense if we have documents
  if (documents.length > 0) {
    try {
      const importResult = await typesense
        .collections(TYPESENSE_COLLECTION)
        .documents()
        .import(documents, { action: 'upsert' });

      // On full success the client returns an array of per-doc results.
      if (Array.isArray(importResult)) {
        let ok = 0;
        let bad = 0;
        importResult.forEach((item, idx) => {
          if (item.success) {
            ok++;
          } else {
            bad++;
            result.failedIds.push(documents[idx].id as string);
            result.errors.push(`Typesense error for ${documents[idx].id}: ${item.error}`);
          }
        });
        result.success += ok;
        result.failed += bad;
      } else {
        result.success += documents.length;
      }
    } catch (err) {
      // typesense-js throws ImportError (with .importResults) when any doc fails.
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`   ⚠️ Typesense import error: ${errorMsg}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = err as any;

      if (anyErr?.importResults && Array.isArray(anyErr.importResults)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const failures = anyErr.importResults.filter((r: any) => r.success === false || r.error);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        failures.slice(0, 5).forEach((r: any) => {
          const docId = r.document?.id || r.document?.ListingKey || 'unknown';
          console.error(`      📋 [${docId}]: ${r.error}`);
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ok = anyErr.importResults.filter((r: any) => r.success).length;
        result.success += ok;
        result.failed += (documents.length - ok);
      } else {
        result.failed += documents.length;
      }
      result.errors.push(`Batch import failed: ${errorMsg}`);
    }
  }

  return result;
}

// ============================================================================
// Cursor-based pagination fetch
// ============================================================================

interface FetchResult {
  records: ListingRecord[];
  lastId: string | null;
  hasMore: boolean;
}

async function fetchChunk(lastId: string | null): Promise<FetchResult> {
  // Retry the fetch with exponential backoff. A throttled instance recovers IO
  // budget over time, so backing off (rather than hammering) is what lets the
  // run make progress. Each attempt rebuilds the query — supabase-js builders
  // are single-use thenables and cannot be awaited twice.
  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt++) {
    let query = supabase
      .from('listings')
      .select('id, listing_key, full_payload, property_hash')
      .order('id', { ascending: true })
      .limit(CHUNK_SIZE);

    if (lastId !== null) {
      query = query.gt('id', lastId);
    }

    const { data, error } = await query;

    if (!error) {
      const records = (data || []) as unknown as ListingRecord[];
      const lastRecordId = records.length > 0 ? records[records.length - 1].id : null;
      return {
        records,
        lastId: lastRecordId,
        hasMore: records.length === CHUNK_SIZE,
      };
    }

    // Non-throttle errors are real bugs — fail fast, don't waste the IO budget.
    if (!isThrottleError(error.message)) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }

    if (attempt === FETCH_MAX_RETRIES) {
      throw new Error(
        `Fetch still timing out after ${FETCH_MAX_RETRIES} retries (instance throttled): ${error.message || 'statement timeout'}`
      );
    }

    const backoff = Math.min(FETCH_BACKOFF_CAP_MS, FETCH_BACKOFF_BASE_MS * 2 ** attempt);
    console.warn(
      `   ⏳ Fetch timed out (attempt ${attempt + 1}/${FETCH_MAX_RETRIES}) — instance likely IO-throttled; backing off ${Math.round(backoff / 1000)}s...`
    );
    await sleep(backoff);
  }

  // Unreachable (loop either returns or throws), but satisfies the type checker.
  throw new Error('Failed to fetch listings: exhausted retries');
}

// ============================================================================
// Main Re-index Loop
// ============================================================================

async function reindexFromVault(): Promise<void> {
  console.log('\n🚀 Shadow MLS - Vault Re-Indexer (Memory-Safe)');
  console.log('===============================================\n');

  console.log('📋 Configuration:');
  console.log(`   Supabase URL: ${SUPABASE_URL.split('//')[1]?.split('.')[0] || 'hidden'}.supabase.co`);
  console.log(`   Chunk size: ${CHUNK_SIZE} records`);
  console.log(`   Transform concurrency: ${TRANSFORM_CONCURRENCY}`);
  console.log(`   Typesense collection: ${TYPESENSE_COLLECTION}`);
  console.log('');

  // Ensure postal codes are loaded
  await ensurePostalCodesLoaded();

  // Count total for the progress display only (best-effort). An `exact` count on
  // the full 112k listings table exceeds the Postgres statement timeout (error
  // 57014), so use the planner estimate and treat any failure as NON-FATAL — the
  // loop paginates by cursor and does not depend on this number.
  console.log('🔍 Estimating total listings in vault...');
  let totalRecords = 0;
  const { count, error: countError } = await supabase
    .from('listings')
    .select('*', { count: 'estimated', head: true });

  if (countError) {
    console.warn(`   ⚠️  Count unavailable (non-fatal): ${countError.message || 'statement timeout'} — progress % disabled`);
  } else {
    totalRecords = count ?? 0;
    console.log(`   Estimated listings: ${totalRecords.toLocaleString()}`);
  }
  console.log('');

  // Load the shared transformer before the loop.
  await ensureTransformerLoaded();

  // ========== MAIN LOOP ==========
  console.log('📦 Starting memory-safe re-index (active inventory only)...\n');

  // Resume from a prior interrupted run if a checkpoint exists. The reindex is
  // idempotent (Typesense upsert), but resuming avoids re-reading already-done
  // rows — i.e. avoids re-spending the scarce Disk IO budget on work we did.
  let lastId: string | null = null;
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      // listings.id is a UUID, not an integer — read it verbatim. (parseInt(uuid,10)
      // returns NaN, which silently disabled resume and restarted from id=0 every run.)
      const saved = fs.readFileSync(CHECKPOINT_FILE, 'utf8').trim();
      if (saved) {
        lastId = saved;
        console.log(`↩️  Resuming from checkpoint: id > ${lastId} (delete ${CHECKPOINT_FILE} to start over)\n`);
      }
    }
  } catch { /* checkpoint is best-effort */ }

  let processedCount = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let batchNumber = 0;

  // Create a flag for tracking completion
  let hasMore = true;

  while (hasMore) {
    batchNumber++;

    // Fetch next chunk using cursor. fetchChunk retries timeouts internally with
    // backoff; if it still throws, the instance hasn't recovered — abort cleanly
    // so we stop spending IO. The checkpoint lets a later re-run resume.
    let fetchResult: FetchResult;
    try {
      fetchResult = await fetchChunk(lastId);
    } catch (err) {
      console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
      console.error(
        `   Progress saved at id ${lastId ?? '(start)'} → ${CHECKPOINT_FILE}.` +
        ` Wait for the Supabase Disk IO budget to refill, then re-run to resume.`
      );
      break;
    }

    const { records, lastId: newLastId } = fetchResult;
    lastId = newLastId;
    hasMore = fetchResult.hasMore;

    if (records.length === 0) {
      break;
    }

    // Process the batch
    let batchResult: TransformResult;
    try {
      batchResult = await processBatch(records);
    } catch (err) {
      console.error(`\n❌ Batch ${batchNumber} processing failed:`, err);
      batchResult = {
        success: 0,
        failed: records.length,
        skipped: 0,
        failedIds: records.map(r => r.listing_key),
        errors: [String(err)]
      };
    }

    // Update counters
    processedCount += records.length;
    totalSuccess += batchResult.success;
    totalFailed += batchResult.failed;
    totalSkipped += batchResult.skipped;

    // ========== Progress Logging ==========
    const haveTotal = totalRecords > 0;
    const progress = haveTotal ? `${((processedCount / totalRecords) * 100).toFixed(1)}%` : '—';
    const totalStr = haveTotal ? totalRecords.toLocaleString() : '?';
    const eta = !hasMore
      ? ' (COMPLETE)'
      : haveTotal
        ? ` (ETA: ~${Math.ceil((totalRecords - processedCount) / CHUNK_SIZE)} batches)`
        : '';

    console.log(
      `[Reindex] Processed ${processedCount.toLocaleString()} / ${totalStr}` +
      ` (${progress})` +
      ` | Batch ${batchNumber} [+${batchResult.success}` +
      `${batchResult.failed > 0 ? `,-${batchResult.failed}` : ''}` +
      `${batchResult.skipped > 0 ? `,~${batchResult.skipped} skipped` : ''}]` +
      eta
    );

    // Log errors if any
    if (batchResult.errors.length > 0 && batchResult.errors.length <= 5) {
      batchResult.errors.forEach(e => console.log(`   ⚠️  ${e}`));
    } else if (batchResult.errors.length > 5) {
      console.log(`   ⚠️  ${batchResult.errors.length} errors in batch (truncated)`);
    }

    // ========== Checkpoint ==========
    // Persist the cursor only after the batch is fully processed, so a resume
    // never skips un-indexed rows.
    if (lastId !== null) {
      try { fs.writeFileSync(CHECKPOINT_FILE, String(lastId)); } catch { /* best-effort */ }
    }

    // ========== Memory Cleanup ==========
    // Explicitly clear arrays to help GC
    records.length = 0;

    // Idle gap between batches to let the Disk IO burst budget refill.
    if (hasMore) {
      await sleep(BASE_BATCH_DELAY_MS);
    }
  }

  // Clear the checkpoint on a clean, complete pass.
  if (!hasMore) {
    try { if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE); } catch { /* best-effort */ }
  }

  // ========== Summary ==========
  console.log('\n===============================================');
  console.log('📊 Re-Index Complete!');
  console.log('===============================================');
  console.log(`   Batches processed: ${batchNumber}`);
  console.log(`   Total records scanned: ${processedCount.toLocaleString()}`);
  console.log(`   Successfully indexed: ${totalSuccess.toLocaleString()}`);
  console.log(`   Skipped (non-active): ${totalSkipped.toLocaleString()}`);
  console.log(`   Failed: ${totalFailed.toLocaleString()}`);

  if (totalFailed > 0) {
    console.warn(`\n⚠️  ${totalFailed} records failed. Check logs above.`);
  }

  // Verify Typesense count
  try {
    const stats = await typesense.collections(TYPESENSE_COLLECTION).retrieve() as { num_documents: number };
    console.log(`\n✅ Typesense collection contains: ${stats.num_documents.toLocaleString()} documents`);
  } catch (err) {
    console.log('\n⚠️  Could not verify Typesense count');
  }

  console.log('\n');
}

// ============================================================================
// Entry Point
// ============================================================================

reindexFromVault()
  .then(() => {
    console.log('[Reindex] Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Re-indexer crashed:', error);
    process.exit(1);
  });
