/**
 * Shadow MLS — Make "which way it faces" filterable in the `properties` collection.
 *
 * Adds DirectionFaces (the normalised compass facing — DirectionFaces for houses,
 * Exposure for condos; see src/lib/listings/directionFaces.ts) as a faceted string
 * on the live `properties` collection, then backfills it onto existing docs.
 *
 * Unlike TransactionType (already stored on every doc, so an export→import sufficed),
 * DirectionFaces has NEVER been written to Typesense, so the value must be DERIVED
 * from the raw payload in Supabase `listings.full_payload` and pushed to Typesense by
 * id (= ListingKey).
 *
 * IO-frugal (cf. 2026-05-19 Disk IO Budget incident): reads ONLY the two JSONB
 * sub-keys it needs, keyset-paginates on listing_key, batches tiny Typesense update
 * imports, idles between pages. Idempotent + resumable. The DRY-RUN reads but never
 * writes, so it doubles as a fill-rate / value-distribution probe.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/admin/add-direction-faces.ts                  # dry-run + distribution
 *   npx tsx --env-file=.env scripts/admin/add-direction-faces.ts --apply          # alter + backfill
 *   npx tsx --env-file=.env scripts/admin/add-direction-faces.ts --apply --resume # continue from cursor
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import Typesense from 'typesense';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import crossFetch from 'cross-fetch';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';
import { normalizeDirectionFaces } from '@/lib/listings/directionFaces';

// Patch global fetch with a TLS-relaxed agent for the Supabase client.
const agent = new https.Agent({ rejectUnauthorized: false });
(global as unknown as { fetch: typeof fetch }).fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
  // @ts-expect-error agent is a node-fetch option, not standard
  crossFetch(url, { ...init, agent })) as typeof fetch;

// ── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');

// ── Config ───────────────────────────────────────────────────────────────────
const FIELD = 'DirectionFaces';
const COLLECTION = 'properties';
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const CHUNK_SIZE = 500;     // Supabase rows per page (two small JSONB sub-keys each)
const IMPORT_CHUNK = 2000;  // Typesense update docs per import call
const INTER_CHUNK_DELAY_MS = 200; // idle gap between pages to let the IO budget refill
const CURSOR_FILE = path.join(process.cwd(), 'scripts', 'admin', '.backfill-faces-cursor.json');

if (!TYPESENSE_KEY) { console.error('❌ TYPESENSE_ADMIN_API_KEY not set'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: TYPESENSE_KEY,
  connectionTimeoutSeconds: 120,
});
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

// ── 1. ALTER: add the faceted field to the live collection ───────────────────
async function fieldExists(): Promise<boolean> {
  const coll: AnyObj = await ts.collections(COLLECTION).retrieve();
  return (coll.fields || []).some((f: AnyObj) => f.name === FIELD);
}

async function alterCollection() {
  if (await fieldExists()) {
    console.log(`✅ '${FIELD}' already a schema field — no alter needed.`);
    return;
  }
  const def = (typesenseSchema.fields as AnyObj[]).find((f) => f.name === FIELD);
  if (!def) throw new Error(`${FIELD} not in typesenseSchema.fields — declare it there first.`);
  console.log(`Adding faceted field: ${JSON.stringify(def)}`);
  if (!APPLY) { console.log('   (dry-run — skipping alter)'); return; }
  await ts.collections(COLLECTION).update({ fields: [def] } as AnyObj);
  console.log('   ✅ Collection altered.');
}

// ── 2. BACKFILL: derive from Supabase full_payload, patch Typesense by id ─────
interface FacesRow { listing_key: string; dir: unknown; exp: unknown; }

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
    try {
      const res: AnyObj = await ts.collections(COLLECTION).documents().import(slice.join('\n'), { action: 'update' });
      if (Array.isArray(res)) res.forEach((r: AnyObj) => (r.success ? ok++ : failed++));
      else ok += slice.length;
    } catch (e: AnyObj) {
      // import(action:'update') throws ImportError when any doc is missing from the
      // active index (a listing that isn't in `properties`). Count, don't crash.
      const results = e?.importResults;
      if (Array.isArray(results)) results.forEach((r: AnyObj) => (r.success ? ok++ : failed++));
      else failed += slice.length;
    }
  }
  return { ok, failed };
}

async function backfill() {
  let cursor = readCursor();
  if (cursor) console.log(`▶️  Resuming after listing_key > "${cursor}"`);

  let processed = 0, totalOk = 0, totalFailed = 0, withFacing = 0;
  const dist = new Map<string, number>();
  const bump = (k: string) => dist.set(k, (dist.get(k) || 0) + 1);

  for (;;) {
    const { data, error } = await sb
      .from('listings')
      .select('listing_key, dir:full_payload->DirectionFaces, exp:full_payload->Exposure')
      .gt('listing_key', cursor)
      .order('listing_key', { ascending: true })
      .limit(CHUNK_SIZE);

    if (error) { console.error(`❌ Read failed at "${cursor}": ${error.message}`); process.exitCode = 1; break; }
    if (!data || data.length === 0) { console.log('✅ Reached end of table.'); break; }

    const rows = data as unknown as FacesRow[];
    const updates: string[] = [];
    for (const r of rows) {
      const value = normalizeDirectionFaces({ DirectionFaces: r.dir, Exposure: r.exp });
      bump(value || '(none)');
      if (value) withFacing++;
      // Write '' too, so every doc carries the field (clean facet — no missing values).
      updates.push(JSON.stringify({ id: r.listing_key, [FIELD]: value }));
    }

    if (APPLY) {
      const res = await importUpdates(updates);
      totalOk += res.ok; totalFailed += res.failed;
    }

    processed += rows.length;
    cursor = rows[rows.length - 1].listing_key;
    if (APPLY) writeCursor(cursor, processed);
    console.log(`   …${processed} processed${APPLY ? ` (${totalOk} ok, ${totalFailed} failed)` : ''} — last key ${cursor}`);

    if (rows.length < CHUNK_SIZE) { console.log('✅ Last page.'); break; }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  console.log('\n──────── Summary ────────');
  console.log(`Processed: ${processed} · with a facing: ${withFacing} (${processed ? ((withFacing / processed) * 100).toFixed(1) : '0'}%)`);
  if (APPLY) console.log(`Typesense updates: ${totalOk} ok, ${totalFailed} failed (failed = not in active index)`);
  const top = [...dist.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join('  ');
  console.log(`Distribution → ${top}`);
  if (!APPLY) console.log('\n(DRY-RUN — no writes. Re-run with --apply to alter + backfill.)');
}

async function main() {
  console.log(`\n🧭 Add DirectionFaces filter  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  await alterCollection();
  await backfill();
}

main().catch((e) => { console.error('❌ Failed:', e?.message || e); process.exit(1); });
