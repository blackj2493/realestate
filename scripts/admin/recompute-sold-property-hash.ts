/**
 * Repair raw_vow_sold.property_hash so it joins to listings.property_hash.
 *
 * WHY: ~92% of the archive was bulk-loaded with property_hash set to an un-hashed
 * address string ("2945thomasstreet102mississauga…") by an older implementation, while
 * `listings` carries proper SHA-256 from generatePropertyHash(). Two key spaces in one
 * column means the documented cross-table join (ingester.ts:55 — "computed with the SAME
 * generatePropertyHash() the listings table uses so AVM/temporal stitching can join the
 * two on hash") silently matches nothing for most rows.
 *
 * SAFE TO RUN: nothing trusts the stored value today. The one consumer that needs it —
 * refresh-property-sale-history.ts:150 — already recomputes from the address components
 * for exactly this reason, and new rows from ingester.ts:249 are already correct. This
 * makes the stored column agree with what every consumer already computes.
 *
 * Reads only the five projected address fields, never the whole raw_payload, so this
 * does not detoast 300k JSON blobs.
 *
 * Usage:
 *   npx tsx scripts/admin/recompute-sold-property-hash.ts              # dry-run
 *   npx tsx scripts/admin/recompute-sold-property-hash.ts --apply      # write
 *   npx tsx scripts/admin/recompute-sold-property-hash.ts --limit 5000 # bounded probe
 */
import 'dotenv/config';
import { Client } from 'pg';
import { generatePropertyHash } from '@/lib/typesense/TemporalDistressEngine';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const ROW_LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const PAGE = 5000;

const IS_SHA256 = /^[0-9a-f]{64}$/;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set (Supabase Session pooler string — CLAUDE.md §12)');
    process.exit(1);
  }
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  // Fail loudly rather than hang. Without this a pathological statement just sits there
  // and the run is indistinguishable from progress.
  await db.query(`SET statement_timeout = '120s'`);

  console.log('========================================');
  console.log('  Recompute raw_vow_sold.property_hash');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  console.log('========================================\n');

  // Reversibility first. CLAUDE.md §12 calls raw_vow_sold "read-only for AVM,
  // append-only for daily sync" — a bulk column update is neither, so the old values
  // are copied to a NEW table before a single row changes. Restore with:
  //   UPDATE raw_vow_sold t SET property_hash = b.property_hash
  //     FROM raw_vow_sold_property_hash_backup b WHERE t.listing_key = b.listing_key;
  if (APPLY) {
    const { rows: existing } = await db.query<{ n: string }>(
      `SELECT to_regclass('public.raw_vow_sold_property_hash_backup') IS NOT NULL AS n`
    );
    if (String(existing[0].n) === 'true') {
      const { rows: c } = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM raw_vow_sold_property_hash_backup`
      );
      console.log(`  backup already exists (${c[0].n} rows) — leaving it untouched\n`);
    } else {
      console.log('  taking backup → raw_vow_sold_property_hash_backup …');
      await db.query(
        `CREATE TABLE raw_vow_sold_property_hash_backup AS
           SELECT listing_key, property_hash FROM raw_vow_sold`
      );
      await db.query(
        `ALTER TABLE raw_vow_sold_property_hash_backup ADD PRIMARY KEY (listing_key)`
      );
      const { rows: c } = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM raw_vow_sold_property_hash_backup`
      );
      console.log(`  backup written: ${c[0].n} rows\n`);
    }
  }

  let cursor = '';
  let scanned = 0;
  let changed = 0;
  let alreadyOk = 0;
  let unhashable = 0;
  let legacySeen = 0;
  const samples: string[] = [];

  try {
    while (scanned < ROW_LIMIT) {
      const pageSize = Math.min(PAGE, ROW_LIMIT - scanned);
      const { rows } = await db.query<{
        listing_key: string;
        property_hash: string | null;
        sn: string | null;
        st: string | null;
        city: string | null;
        unit: string | null;
        ua: string | null;
      }>(
        `SELECT listing_key,
                property_hash,
                raw_payload->>'StreetNumber'    AS sn,
                raw_payload->>'StreetName'      AS st,
                raw_payload->>'City'            AS city,
                raw_payload->>'UnitNumber'      AS unit,
                raw_payload->>'UnparsedAddress' AS ua
           FROM raw_vow_sold
          WHERE listing_key > $1
          ORDER BY listing_key
          LIMIT $2`,
        [cursor, pageSize]
      );
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].listing_key;
      scanned += rows.length;

      const updates: Array<[string, string]> = [];
      for (const r of rows) {
        if (r.property_hash && !IS_SHA256.test(r.property_hash)) legacySeen++;
        // Same inputs the nightly precompute uses, so both agree by construction.
        const next = generatePropertyHash({
          StreetNumber: r.sn,
          StreetName: r.st,
          City: r.city,
          UnitNumber: r.unit,
          UnparsedAddress: r.ua,
        });
        // No address at all -> leave the row alone rather than write a hash of nothing,
        // which would collide every address-less row onto one "property".
        if (!next || (!r.sn && !r.st && !r.ua)) {
          unhashable++;
          continue;
        }
        if (next === r.property_hash) {
          alreadyOk++;
          continue;
        }
        changed++;
        if (samples.length < 5) {
          samples.push(`   ${r.listing_key}  "${String(r.property_hash).slice(0, 26)}..." -> ${next.slice(0, 16)}...  (${r.ua ?? ''})`);
        }
        updates.push([r.listing_key, next]);
      }

      let pageMs = 0;
      if (APPLY && updates.length) {
        // unnest($1::text[], $2::text[]) rather than a VALUES list of 2N bound params:
        // same PK index scan either way, but the planner gets real types and cardinality,
        // and it measured 5.7x faster (0.33 vs 1.86 ms/row) -- ~1 min vs ~7 min overall.
        const t0 = Date.now();
        await db.query(
          `UPDATE raw_vow_sold AS t
              SET property_hash = d.h
             FROM (SELECT * FROM unnest($1::text[], $2::text[]) AS u(k, h)) AS d
            WHERE t.listing_key = d.k`,
          [updates.map((u) => u[0]), updates.map((u) => u[1])]
        );
        pageMs = Date.now() - t0;
      }

      // Log EVERY page. The old every-50k rule made a slow run indistinguishable from a
      // hung one: 10 minutes of silence looked identical either way, and the only way to
      // tell was to go count rows in another session.
      console.log(
        `  scanned ${scanned}  changed ${changed}  already-ok ${alreadyOk}  no-address ${unhashable}` +
          (APPLY ? `  (page write ${pageMs}ms)` : '')
      );
      if (rows.length < pageSize) break;
    }

    console.log('\n--- summary ---');
    console.log(`  scanned            : ${scanned}`);
    console.log(`  legacy (non-sha256): ${legacySeen}`);
    console.log(`  would change       : ${changed}${APPLY ? ' (WRITTEN)' : ''}`);
    console.log(`  already correct    : ${alreadyOk}`);
    console.log(`  skipped, no address: ${unhashable}`);
    if (samples.length) {
      console.log('\n  samples:');
      for (const s of samples) console.log(s);
    }
    if (!APPLY) console.log('\n  DRY-RUN - re-run with --apply to write.');
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
