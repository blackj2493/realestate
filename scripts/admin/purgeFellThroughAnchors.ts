/**
 * Purge sale anchors for deals that FELL THROUGH.
 *
 * raw_vow_sold is the AVM's sale-anchor table: every row asserts "this listing closed at
 * close_price on purchase_contract_date". Query B upserts a row the moment the feed reports
 * StandardStatus 'Closed', and NOTHING ever removes one. When a firm sale collapses, TRREB
 * flips the listing back to Active with MlsStatus 'Deal Fell Through' — and the anchor for
 * a sale that never completed stays behind, priced, dated, and indistinguishable from a
 * real close.
 *
 * Found 2026-08-27 while scoping the ghost repair: 107 such anchors out of ~536k. Tiny, but
 * every one is a price nobody ever paid sitting in the AVM's training input.
 *
 * The vault payload alone is NOT sufficient evidence to delete. A deal can fall through and
 * the property sell later under the SAME ListingKey, in which case the anchor is a real
 * close and the vault row is simply stale. So every candidate is verified against the VOW
 * feed per key, and only keys the feed still reports as not-Closed are purged. Rows are
 * written to a backup file before the delete.
 *
 * Dry-run by default. Run:
 *   npx tsx scripts/admin/purgeFellThroughAnchors.ts [--apply] [--out=path.json]
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const APPLY = process.argv.includes('--apply');
const OUT = (process.argv.find((a) => a.startsWith('--out=')) || '').split('=')[1]
  || 'fell-through-anchors-backup.json';
const BASE = process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata';
const CHUNK = 50;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function feedStatuses(keys: string[], token: string) {
  const out = new Map<string, any>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const filter = chunk.map((k) => `ListingKey eq '${k}'`).join(' or ');
    const url =
      `${BASE}/Property?$filter=${encodeURIComponent(filter)}` +
      `&$select=${encodeURIComponent('ListingKey,StandardStatus,MlsStatus,ClosePrice,PurchaseContractDate')}` +
      `&$top=${CHUNK}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
    const j: any = await res.json();
    for (const r of j.value ?? []) out.set(r.ListingKey, r);
    await sleep(80);
  }
  return out;
}

async function main() {
  const token = (process.env.PROPTX_VOW_TOKEN || '').trim();
  if (!token) throw new Error('PROPTX_VOW_TOKEN missing');
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(`SET statement_timeout TO '300s'`);
    const { rows: candidates } = await pg.query(`
      SELECT s.*
        FROM listings l JOIN raw_vow_sold s ON s.listing_key = l.listing_key
       WHERE lower(coalesce(l.full_payload->>'MlsStatus','')) = 'deal fell through'
         AND s.close_price > 0`);
    console.log(`candidates (vault payload says Deal Fell Through, anchor has a price): ${candidates.length}`);
    if (!candidates.length) return;

    const feed = await feedStatuses(candidates.map((r: any) => r.listing_key), token);

    const purge: any[] = [];
    const keep: any[] = [];
    const tally: Record<string, number> = {};
    for (const row of candidates) {
      const f = feed.get(row.listing_key);
      const label = f ? `${f.StandardStatus}/${f.MlsStatus}` : 'NOT_IN_FEED';
      tally[label] = (tally[label] ?? 0) + 1;
      // Only the feed can clear a row for deletion. 'Closed' means the sale DID complete
      // (possibly on a second try) — the anchor is real and the vault row is merely stale.
      if (f && f.StandardStatus === 'Closed') keep.push({ row, feed: f });
      else purge.push(row);
    }
    console.log('\nfeed says:');
    for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
    console.log(`\n→ purge ${purge.length} · keep ${keep.length} (feed confirms a real close)`);
    if (keep.length) {
      console.log('   kept:', keep.slice(0, 10).map((k) => k.row.listing_key).join(', '));
    }
    if (!purge.length) { console.log('nothing to purge.'); return; }

    const sum = purge.reduce((a, r) => a + Number(r.close_price || 0), 0);
    console.log(`   purged anchors carry ${purge.length} phantom prices totalling $${sum.toLocaleString()}`);

    if (!APPLY) {
      console.log('\nDRY RUN — re-run with --apply to delete. Backup would be written to', OUT);
      return;
    }
    fs.writeFileSync(OUT, JSON.stringify(purge, null, 2));
    console.log(`\nbackup written: ${OUT} (${purge.length} rows)`);

    const keys = purge.map((r) => r.listing_key);
    const res = await pg.query(`DELETE FROM raw_vow_sold WHERE listing_key = ANY($1::text[])`, [keys]);
    console.log(`✅ deleted ${res.rowCount} anchor(s) from raw_vow_sold`);
  } finally {
    await pg.end();
  }
}
main().catch((e) => { console.error('purge failed:', e?.message || e); process.exit(1); });
