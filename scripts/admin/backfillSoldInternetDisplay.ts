/**
 * Backfill raw_vow_sold.internet_display_optout / internet_address_optout from
 * raw_payload (migration 137).
 *
 * MUST RUN GREEN BEFORE THE SITEMAP CHANGE SHIPS. /addresses/sitemap.xml requires an
 * explicit `false` on both columns, so every row still NULL is a sold page that
 * silently vanishes from the sitemap. That is the safe direction to fail — a missing
 * URL costs traffic, a wrongly-published one breaks a seller's opt-out — but it is
 * still a hole, so this exits non-zero while any row is unset.
 *
 * The SQL mirrors isExplicitNo() in src/lib/compliance/internetDisplay.ts exactly:
 * ONLY an explicit No is an opt-out. `->>` renders a JSON boolean false as the string
 * 'false'; hand-entered payloads also carry 'N'/'No'. A key that is ABSENT yields NULL
 * from `->>`, and COALESCE turns that into false — absent is NOT an opt-out, and
 * treating it as one would empty the sitemap (the great majority of payloads omit the
 * fields entirely).
 *
 * Keyset-paginated with a plain VACUUM every VACUUM_EVERY batches, so the heap reuses
 * its own freed space instead of growing the file.
 *
 * Idempotent and resumable: only rows with a NULL on either column are touched.
 *
 * Usage:
 *   npx tsx scripts/admin/backfillSoldInternetDisplay.ts            # dry-run
 *   npx tsx scripts/admin/backfillSoldInternetDisplay.ts --apply
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

/** The one expression that defines "opted out" in SQL. Mirrors isExplicitNo(). */
const optedOut = (field: string) =>
  `COALESCE(lower(raw_payload->>'${field}') IN ('false','n','no'), false)`;

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log(`✅ connected — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    const { rows: [pre] } = await c.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE internet_display_optout IS NULL
                                 OR internet_address_optout IS NULL)::int AS todo
      FROM raw_vow_sold`);
    console.log(`   ${n(pre.total)} sold rows — ${n(pre.todo)} to go`);

    if (!APPLY) {
      // What the backfill WOULD find. Counted straight off the payload, so this also
      // doubles as the check that the SQL matches the TypeScript predicate.
      const { rows: [would] } = await c.query(`
        SELECT count(*) FILTER (WHERE ${optedOut('InternetEntireListingDisplayYN')})::int AS listing_optout,
               count(*) FILTER (WHERE ${optedOut('InternetAddressDisplayYN')})::int AS address_optout,
               count(*) FILTER (WHERE ${optedOut('InternetEntireListingDisplayYN')}
                                   OR ${optedOut('InternetAddressDisplayYN')})::int AS either
        FROM raw_vow_sold`);
      console.table([would]);
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
           WHERE (internet_display_optout IS NULL OR internet_address_optout IS NULL)
             AND listing_key > $1
           ORDER BY listing_key LIMIT $2
         )
         UPDATE raw_vow_sold t
            SET internet_display_optout = ${optedOut('InternetEntireListingDisplayYN')},
                internet_address_optout = ${optedOut('InternetAddressDisplayYN')}
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
             count(*) FILTER (WHERE internet_display_optout IS NULL
                                 OR internet_address_optout IS NULL)::int AS still_null,
             count(*) FILTER (WHERE internet_display_optout)::int AS listing_optout,
             count(*) FILTER (WHERE internet_address_optout)::int AS address_optout,
             count(*) FILTER (WHERE internet_display_optout OR internet_address_optout)::int AS either
      FROM raw_vow_sold`);

    console.log(`\n✅ backfilled ${n(done)} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.table([{
      listing_optout: post.listing_optout,
      address_optout: post.address_optout,
      either: post.either,
      publishable: post.total - post.either,
    }]);

    if (post.still_null > 0) {
      console.error(`\n❌ ${n(post.still_null)} rows still NULL — the sitemap would drop them. Do NOT ship the code change yet.`);
      process.exit(1);
    }
    console.log(`   every one of ${n(post.total)} rows now carries both flags.`);
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
