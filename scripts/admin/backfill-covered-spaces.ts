/**
 * Shadow MLS — Backfill CoveredSpaces (garage count) into the live `properties`
 * index so the Garage filter actually matches inventory.
 *
 * CoveredSpaces is ALREADY a declared int32 (no alter needed) and the transformer
 * emits it, but the live index predates that emission — only ~2.7% of docs carry it
 * while ~53% of raw payloads have it. This patches it in-place from Supabase
 * `listings.full_payload`, mirroring scripts/admin/add-direction-faces.ts.
 *
 * Preserves the absent≠0 semantics (schema note): writes the value ONLY when the
 * feed asserts one (incl. an explicit 0 = "no garage"); a missing value is left
 * absent (unknown), never coerced to 0.
 *
 * IO-frugal + idempotent + resumable. DRY-RUN reads only (fill-rate probe).
 *   npx tsx --env-file=.env scripts/admin/backfill-covered-spaces.ts            # dry-run
 *   npx tsx --env-file=.env scripts/admin/backfill-covered-spaces.ts --apply    # write
 *   npx tsx --env-file=.env scripts/admin/backfill-covered-spaces.ts --apply --resume
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import Typesense from 'typesense';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import crossFetch from 'cross-fetch';

const agent = new https.Agent({ rejectUnauthorized: false });
(global as unknown as { fetch: typeof fetch }).fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
  // @ts-expect-error agent is a node-fetch option
  crossFetch(url, { ...init, agent })) as typeof fetch;

const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');

const FIELD = 'CoveredSpaces';
const COLLECTION = 'properties';
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const CHUNK_SIZE = 500;
const IMPORT_CHUNK = 2000;
const INTER_CHUNK_DELAY_MS = 200;
const CURSOR_FILE = path.join(process.cwd(), 'scripts', 'admin', '.backfill-covered-cursor.json');

if (!TYPESENSE_KEY) { console.error('❌ TYPESENSE_ADMIN_API_KEY not set'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('❌ Missing Supabase env'); process.exit(1); }

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: TYPESENSE_KEY,
  connectionTimeoutSeconds: 120,
});
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

/** Mirror of transformer.ts: present iff not null/undefined/'' and a finite int (incl. 0). */
function parseCovered(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function readCursor(): string {
  if (RESUME && fs.existsSync(CURSOR_FILE)) {
    try { return JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8')).cursor || ''; } catch { return ''; }
  }
  return '';
}
function writeCursor(cursor: string, processed: number) {
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor, processed, ts: new Date().toISOString() }, null, 2));
}

async function importUpdates(updates: string[]): Promise<{ ok: number; failed: number }> {
  let ok = 0, failed = 0;
  for (let i = 0; i < updates.length; i += IMPORT_CHUNK) {
    const slice = updates.slice(i, i + IMPORT_CHUNK);
    if (slice.length === 0) continue;
    try {
      const res: AnyObj = await ts.collections(COLLECTION).documents().import(slice.join('\n'), { action: 'update' });
      if (Array.isArray(res)) res.forEach((r: AnyObj) => (r.success ? ok++ : failed++));
      else ok += slice.length;
    } catch (e: AnyObj) {
      const results = e?.importResults;
      if (Array.isArray(results)) results.forEach((r: AnyObj) => (r.success ? ok++ : failed++));
      else failed += slice.length;
    }
  }
  return { ok, failed };
}

interface Row { listing_key: string; cov: unknown; }

async function main() {
  console.log(`\n🅿️  Backfill CoveredSpaces (garage count)  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));

  let cursor = readCursor();
  if (cursor) console.log(`▶️  Resuming after listing_key > "${cursor}"`);

  let processed = 0, withVal = 0, totalOk = 0, totalFailed = 0;
  const dist = new Map<number, number>();

  for (;;) {
    const { data, error } = await sb
      .from('listings')
      .select('listing_key, cov:full_payload->CoveredSpaces')
      .gt('listing_key', cursor)
      .order('listing_key', { ascending: true })
      .limit(CHUNK_SIZE);

    if (error) { console.error(`❌ Read failed at "${cursor}": ${error.message}`); process.exitCode = 1; break; }
    if (!data || data.length === 0) { console.log('✅ Reached end of table.'); break; }

    const rows = data as unknown as Row[];
    const updates: string[] = [];
    for (const r of rows) {
      const n = parseCovered(r.cov);
      // Only write when the feed asserts a value — preserve absent≠0 (unknown vs none).
      if (n !== null) {
        withVal++;
        dist.set(n, (dist.get(n) || 0) + 1);
        updates.push(JSON.stringify({ id: r.listing_key, [FIELD]: n }));
      }
    }

    if (APPLY && updates.length) {
      const res = await importUpdates(updates);
      totalOk += res.ok; totalFailed += res.failed;
    }

    processed += rows.length;
    cursor = rows[rows.length - 1].listing_key;
    if (APPLY) writeCursor(cursor, processed);
    console.log(`   …${processed} processed (${withVal} with value${APPLY ? `, ${totalOk} ok, ${totalFailed} failed` : ''}) — last key ${cursor}`);

    if (rows.length < CHUNK_SIZE) { console.log('✅ Last page.'); break; }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  console.log('\n──────── Summary ────────');
  console.log(`Processed: ${processed} · with CoveredSpaces: ${withVal} (${processed ? ((withVal / processed) * 100).toFixed(1) : '0'}%)`);
  if (APPLY) console.log(`Typesense updates: ${totalOk} ok, ${totalFailed} failed (failed = not in active index)`);
  const buckets = [...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join('  ');
  console.log(`CoveredSpaces values → ${buckets}`);
  if (!APPLY) console.log('\n(DRY-RUN — no writes. Re-run with --apply.)');
}

main().catch((e) => { console.error('❌ Failed:', e?.message || e); process.exit(1); });
