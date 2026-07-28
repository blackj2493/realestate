/**
 * Parity check: the TypeScript extractor used by the nightly ingester
 * (photosFromRawMedia) must produce EXACTLY what the SQL backfill wrote into
 * raw_vow_sold.photos. If they drift, rows ingested tonight would carry a different
 * photo set from rows backfilled by migration 101 — a silent inconsistency that would
 * only surface as "some sold listings have odd galleries".
 *
 * Run this before stripping raw_payload->media (while both still exist), and again
 * any time either extractor changes.
 *
 * Usage: npx tsx scripts/admin/verifyPhotosParity.ts [--limit 5000]
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import { photosFromRawMedia } from '../worker/ingester';
dotenv.config({ path: ['.env.local', '.env'] });

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 5000;

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log(`✅ connected — comparing TS extractor vs stored photos on ${LIMIT} rows\n`);
  try {
    const { rows } = await c.query(
      `SELECT listing_key, raw_payload, photos
       FROM raw_vow_sold
       WHERE raw_payload ? 'media' AND photos IS NOT NULL
       ORDER BY listing_key
       LIMIT $1`, [LIMIT]);

    // Compare semantically. Postgres jsonb does not preserve object key insertion order
    // (it stores keys sorted by length then bytes), so a raw JSON.stringify would flag
    // {"u":…,"c":…} vs {"c":…,"u":…} as a difference when the data is identical.
    // Canonicalise both sides to (url, caption) pairs in array order.
    const norm = (arr: Array<{ u: string; c?: string }>) =>
      JSON.stringify((arr ?? []).map((p) => [p.u, p.c ?? null]));

    let checked = 0, mismatched = 0, totalPhotos = 0;
    const examples: string[] = [];
    for (const r of rows) {
      const ts = photosFromRawMedia(r.raw_payload as Record<string, unknown>);
      const sql = r.photos as Array<{ u: string; c?: string }>;
      checked++;
      totalPhotos += sql.length;
      if (norm(ts) !== norm(sql)) {
        mismatched++;
        if (examples.length < 3) {
          // Show the first position where they actually differ, not the first 2 entries.
          const a = ts.map((p) => [p.u, p.c ?? null] as const);
          const b = (sql ?? []).map((p) => [p.u, p.c ?? null] as const);
          let i = 0;
          while (i < Math.min(a.length, b.length) &&
                 a[i][0] === b[i][0] && a[i][1] === b[i][1]) i++;
          examples.push(
            `   ${r.listing_key}: ts=${ts.length} sql=${sql.length}, first diff at index ${i}\n` +
            `      ts : ${JSON.stringify(a[i] ?? null)}\n` +
            `      sql: ${JSON.stringify(b[i] ?? null)}`
          );
        }
      }
    }

    console.log(`   rows compared : ${checked}`);
    console.log(`   photos covered: ${totalPhotos}`);
    console.log(`   mismatches    : ${mismatched}`);
    if (examples.length) console.log('\n' + examples.join('\n'));
    console.log(`\n${mismatched === 0 ? '✅ PARITY CONFIRMED — nightly and backfilled rows will agree' : '❌ EXTRACTORS DISAGREE — do not strip until fixed'}`);
    process.exit(mismatched === 0 ? 0 : 1);
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
