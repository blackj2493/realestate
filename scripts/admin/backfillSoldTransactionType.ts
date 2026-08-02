/**
 * Backfill raw_vow_sold.transaction_type from raw_payload (migration 104).
 *
 * Additive and behaviour-neutral on its own: nothing reads the column until the
 * AVM comp pulls are repointed at it. That makes this step independently safe and
 * independently verifiable, which is the order it has to happen in — the code
 * change filters `transaction_type = 'For Sale'`, so any row still NULL when that
 * ships would silently vanish from every comparable set.
 *
 * Keyset-paginated with a plain VACUUM every VACUUM_EVERY batches, so the heap
 * reuses its own freed space instead of growing the file.
 *
 * Idempotent and resumable: only NULL rows are touched.
 *
 * Usage:
 *   npx tsx scripts/admin/backfillSoldTransactionType.ts            # dry-run
 *   npx tsx scripts/admin/backfillSoldTransactionType.ts --apply
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
const BATCH = 5000;
const VACUUM_EVERY = 10;

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

const n = (x: number) => x.toLocaleString('en-US');

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log(`✅ connected — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    const { rows: [pre] } = await c.query(`
      SELECT count(*)::int AS total,
             count(transaction_type)::int AS done,
             count(*) FILTER (WHERE transaction_type IS NULL)::int AS todo,
             count(*) FILTER (WHERE transaction_type IS NULL
                                AND NULLIF(raw_payload->>'TransactionType','') IS NULL)::int AS unfillable
      FROM raw_vow_sold`);
    console.log(`   ${n(pre.total)} sold rows — ${n(pre.done)} set, ${n(pre.todo)} to go`);
    if (pre.unfillable > 0) {
      console.log(`   ⚠️  ${n(pre.unfillable)} have no TransactionType in raw_payload either`);
    }

    if (!APPLY) {
      const { rows } = await c.query(`
        SELECT COALESCE(raw_payload->>'TransactionType','(missing)') AS value, count(*)::int AS n
        FROM raw_vow_sold WHERE transaction_type IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
      console.table(rows);
      console.log('\n(dry-run — nothing written. Re-run with --apply)');
      return;
    }

    let cursor = '';
    let done = 0, batches = 0;
    const t0 = Date.now();
    for (;;) {
      const { rows } = await c.query(
        `WITH page AS (
           SELECT listing_key FROM raw_vow_sold
           WHERE transaction_type IS NULL AND listing_key > $1
           ORDER BY listing_key LIMIT $2
         )
         UPDATE raw_vow_sold t
            SET transaction_type = NULLIF(t.raw_payload->>'TransactionType','')
           FROM page WHERE t.listing_key = page.listing_key
         RETURNING t.listing_key`,
        [cursor, BATCH]
      );
      if (rows.length === 0) break;
      cursor = rows.map((r) => r.listing_key).sort().at(-1)!;
      done += rows.length;
      batches++;
      if (batches % VACUUM_EVERY === 0) {
        await c.query('VACUUM raw_vow_sold');
        const el = (Date.now() - t0) / 1000;
        console.log(`   ${n(done)} rows (${(done / el).toFixed(0)}/s) — vacuumed`);
      }
    }
    await c.query('VACUUM (ANALYZE) raw_vow_sold');

    const { rows: [post] } = await c.query(`
      SELECT count(*)::int AS total,
             count(transaction_type)::int AS filled,
             count(*) FILTER (WHERE transaction_type IS NULL)::int AS still_null
      FROM raw_vow_sold`);
    const { rows: dist } = await c.query(`
      SELECT COALESCE(transaction_type,'(null)') AS transaction_type, count(*)::int AS n
      FROM raw_vow_sold GROUP BY 1 ORDER BY 2 DESC`);

    console.log(`\n✅ backfilled ${n(done)} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.table(dist);

    // The code change filters on this column, so a NULL is a silently-dropped comp.
    if (post.still_null > 0) {
      console.error(`\n❌ ${n(post.still_null)} rows still NULL — do NOT ship the code change yet.`);
      process.exit(1);
    }
    console.log(`   every one of ${n(post.total)} rows now carries a transaction type.`);
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
