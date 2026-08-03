/**
 * Backfill active listings the delta sync silently dropped.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Query A (fetchActiveListingsBatch, ingester.ts) pages the active feed with `$skip` OFFSET
 * pagination and NO `$orderby`. Over a long/mutating delta window records shift across page
 * boundaries and get skipped — and because the sync cursor only moves forward, a skipped
 * record is permanently behind it (the ACTIVE-side of the 6 Alexie Way sold-ghost incident,
 * which was fixed for Query B/C by switching to ordered cursor-advance paging). Measured
 * 2026-08-02: 11,067 listings are Active in the feed but ABSENT from our `listings` table —
 * 5,880 of them genuine residential For-Sale homes (~9.6% of the for-sale market), the rest
 * commercial / for-lease / niche (all categories we DO carry, so all belong here).
 *
 * This finds those keys (feed Active minus our table) and re-ingests them through the EXACT
 * daily-sync path (processBatch) so true_dom / campaign history / Typesense doc are all built
 * identically. Media is not fetched inline (the same tradeoff ghostReconcile's sold-repair
 * makes) — the nightly media reconcile heals photos; the listing appears immediately.
 *
 * NOTE: the proper root-cause fix is converting Query A to ordered cursor-advance paging
 * (mirror Query B). This backfill clears the accrued backlog and is a safety net; run it (or a
 * bounded weekly form) until Query A is fixed, after which only a trickle should remain.
 *
 * Usage:
 *   npx tsx scripts/admin/backfill-missing-actives.ts                      # dry-run (count only)
 *   npx tsx scripts/admin/backfill-missing-actives.ts --apply              # ingest all missing
 *   npx tsx scripts/admin/backfill-missing-actives.ts --apply --limit=2000 # bounded pass
 *   npx tsx scripts/admin/backfill-missing-actives.ts --apply --residential-only
 * Env: DATABASE_URL; PROPTX_IDX_TOKEN (by-key fetch); PROPTX_VOW_TOKEN + SUPABASE creds +
 *      TYPESENSE_ADMIN_API_KEY (processBatch).
 */
import 'dotenv/config';
import { Client } from 'pg';
import { processBatch } from '../worker/sync';

const API = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();
const IDX_TOKEN = (process.env.PROPTX_IDX_TOKEN || '').trim();
const KEY_PAGE = 5000;      // $select=ListingKey page size (verified honored)
const FETCH_CHUNK = 50;     // keys per by-key or-chain payload fetch
const PROCESS_CHUNK = 100;  // processBatch page size (mirrors the daily sync)
const RESIDENTIAL_TYPES = new Set(['Residential Freehold', 'Residential Condo & Other']);

function argVal(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function feed(url: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${IDX_TOKEN}` } });
      if (r.ok) return r.json();
    } catch { /* retry */ }
    await sleep(1500 * (i + 1));
  }
  throw new Error('feed fetch failed: ' + url.slice(0, 100));
}

/** Drift-proof keyset enumeration of every active ListingKey. */
async function allActiveKeys(): Promise<string[]> {
  let cursor = '';
  const keys: string[] = [];
  for (;;) {
    const clause = cursor ? `StandardStatus eq 'Active' and ListingKey gt '${cursor}'` : `StandardStatus eq 'Active'`;
    const url = `${API}/Property?$filter=${encodeURIComponent(clause)}&$orderby=ListingKey&$select=ListingKey&$top=${KEY_PAGE}`;
    const rows: any[] = (await feed(url)).value ?? [];
    if (!rows.length) break;
    for (const r of rows) if (r.ListingKey) keys.push(String(r.ListingKey));
    cursor = String(rows[rows.length - 1].ListingKey);
    if (rows.length < KEY_PAGE) break;
  }
  return keys;
}

/** Full payloads for a set of keys via the IDX feed (or-chained, chunked). */
async function fetchPayloads(keys: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < keys.length; i += FETCH_CHUNK) {
    const chunk = keys.slice(i, i + FETCH_CHUNK);
    const filter = chunk.map((k) => `ListingKey eq '${k}'`).join(' or ');
    const url = `${API}/Property?$filter=${encodeURIComponent(filter)}&$top=${FETCH_CHUNK}`;
    const rows: any[] = (await feed(url)).value ?? [];
    out.push(...rows);
    if ((i / FETCH_CHUNK) % 20 === 0) console.log(`   …payloads ${Math.min(i + FETCH_CHUNK, keys.length)}/${keys.length}`);
    await sleep(80);
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const residentialOnly = process.argv.includes('--residential-only');
  const limit = Math.max(0, Number(argVal('--limit')) || 0);
  if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1); }
  if (!IDX_TOKEN) { console.error('❌ PROPTX_IDX_TOKEN not set'); process.exit(1); }

  console.log('========================================');
  console.log('  Backfill missing active listings');
  console.log(`  ${apply ? 'APPLY' : 'DRY-RUN'}${limit ? ` · limit ${limit}` : ''}${residentialOnly ? ' · residential-only' : ''}`);
  console.log('========================================\n');

  console.log('📡 Enumerating active keys from the feed…');
  const activeKeys = await allActiveKeys();
  console.log(`   feed active: ${activeKeys.length}`);

  // Diff against our table.
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  let missingKeys: string[];
  try {
    await c.query('CREATE TEMP TABLE ak (listing_key text PRIMARY KEY)');
    await c.query('INSERT INTO ak SELECT DISTINCT unnest($1::text[]) ON CONFLICT DO NOTHING', [activeKeys]);
    const miss = await c.query(
      `SELECT a.listing_key FROM ak a WHERE NOT EXISTS (SELECT 1 FROM listings l WHERE l.listing_key = a.listing_key) ORDER BY a.listing_key`
    );
    missingKeys = miss.rows.map((r) => r.listing_key as string);
  } finally {
    await c.end();
  }
  console.log(`   missing from our DB: ${missingKeys.length}\n`);

  if (missingKeys.length === 0) { console.log('✅ nothing missing.'); return; }
  if (limit) missingKeys = missingKeys.slice(0, limit);

  if (!apply) {
    console.log(`DRY-RUN — re-run with --apply to fetch + ingest ${missingKeys.length} listing(s)${residentialOnly ? ' (residential only)' : ''}.`);
    console.log('  (per the 2026-08-02 audit: ~5,880 residential For-Sale + ~5,187 commercial/lease/niche.)');
    return;
  }

  console.log(`📥 Fetching payloads for ${missingKeys.length} key(s)…`);
  let payloads = await fetchPayloads(missingKeys);
  console.log(`   fetched ${payloads.length} payloads.`);
  if (residentialOnly) {
    const before = payloads.length;
    payloads = payloads.filter((p) => RESIDENTIAL_TYPES.has(String(p.PropertyType)));
    console.log(`   residential-only: ${payloads.length}/${before} kept.`);
  }

  let ingested = 0, failed = 0;
  for (let i = 0; i < payloads.length; i += PROCESS_CHUNK) {
    const chunk = payloads.slice(i, i + PROCESS_CHUNK);
    try {
      const r = await processBatch(chunk); // active path — builds true_dom + campaign history + Typesense doc
      ingested += r.supabase.inserted;
      failed += r.supabase.failed;
    } catch (e) {
      failed += chunk.length;
      console.warn(`   ⚠️  processBatch chunk ${i} failed:`, (e as Error)?.message ?? e);
    }
    console.log(`   ingested ${Math.min(i + PROCESS_CHUNK, payloads.length)}/${payloads.length} (ok ${ingested}, failed ${failed})`);
  }
  console.log(`\n✅ Backfill complete: ${ingested} ingested, ${failed} failed. (Photos heal via the nightly media reconcile.)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ backfill-missing-actives failed:', e?.message ?? e); process.exit(1); });
