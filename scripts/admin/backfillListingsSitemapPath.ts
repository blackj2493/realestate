/**
 * Backfill listings.sitemap_path from full_payload (migration 138).
 *
 * MUST RUN BEFORE THE SITEMAP CHANGE SHIPS. A NULL is not wrong — the route falls back to
 * /properties/{KEY}, which resolves — but it is non-canonical, and a sitemap full of
 * non-canonical URLs is the very thing #473 set out to fix. The ingester writes the column
 * on every upsert, so after this runs the daily sync keeps it current on its own.
 *
 * TypeScript, not SQL, on purpose: buildListingPath does NFKD folding, diacritic
 * stripping and dash-collapsing that is not worth reimplementing in SQL — and a second
 * implementation would be a second thing to drift from the listing page's canonical.
 *
 * Keyset-paginated on the primary key, so the read never pays a growing offset (that is
 * the bug this whole column exists to kill). Writes go back as one VALUES-joined UPDATE
 * per batch. VACUUM every VACUUM_EVERY batches so the heap reuses its own freed space.
 *
 * Idempotent and resumable: only rows with a NULL sitemap_path are touched.
 *
 * Usage:
 *   npx tsx scripts/admin/backfillListingsSitemapPath.ts            # dry-run
 *   npx tsx scripts/admin/backfillListingsSitemapPath.ts --apply
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import { buildListingPath } from '@/lib/listings/listingPath';
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
const BATCH = 2000;
const VACUUM_EVERY = 10;

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

const n = (x: number) => x.toLocaleString('en-US');

/** The address fields buildListingPath needs, pulled out of the payload. */
const PAGE_SQL = `
  SELECT listing_key,
         full_payload->>'StreetNumber'     AS street_number,
         full_payload->>'StreetName'       AS street_name,
         full_payload->>'StreetSuffix'     AS street_suffix,
         full_payload->>'StreetDirPrefix'  AS street_dir_prefix,
         full_payload->>'StreetDirSuffix'  AS street_dir_suffix,
         full_payload->>'UnitNumber'       AS unit_number,
         full_payload->>'ApartmentNumber'  AS apartment_number,
         full_payload->>'UnparsedAddress'  AS unparsed_address,
         full_payload->>'City'             AS payload_city,
         full_payload->>'StateOrProvince'  AS state_or_province
    FROM listings
   WHERE sitemap_path IS NULL AND listing_key > $1
   ORDER BY listing_key
   LIMIT $2`;

interface PageRow {
  listing_key: string;
  street_number: string | null; street_name: string | null; street_suffix: string | null;
  street_dir_prefix: string | null; street_dir_suffix: string | null;
  unit_number: string | null; apartment_number: string | null;
  unparsed_address: string | null; payload_city: string | null; state_or_province: string | null;
}

const pathFor = (r: PageRow) =>
  buildListingPath({
    ListingKey: r.listing_key,
    StreetNumber: r.street_number,
    StreetName: r.street_name,
    StreetSuffix: r.street_suffix,
    StreetDirPrefix: r.street_dir_prefix,
    StreetDirSuffix: r.street_dir_suffix,
    UnitNumber: r.unit_number,
    ApartmentNumber: r.apartment_number,
    UnparsedAddress: r.unparsed_address,
    City: r.payload_city,
    StateOrProvince: r.state_or_province,
  });

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log(`✅ connected — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    const { rows: [pre] } = await c.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE sitemap_path IS NULL)::int AS todo
      FROM listings`);
    console.log(`   ${n(pre.total)} listings — ${n(pre.todo)} to go`);

    if (!APPLY) {
      const { rows } = await c.query(PAGE_SQL, ['', 5]);
      console.log('\n   sample of what would be written:');
      for (const r of rows as PageRow[]) console.log(`     ${r.listing_key} -> ${pathFor(r) ?? '(null — legacy path)'}`);
      console.log('\n(dry-run — nothing written. Re-run with --apply)');
      return;
    }

    let cursor = '';
    let done = 0, nulls = 0, batches = 0;
    const t0 = Date.now();
    for (;;) {
      const { rows } = await c.query(PAGE_SQL, [cursor, BATCH]);
      const page = rows as PageRow[];
      if (page.length === 0) break;

      // A row whose payload can't form a path still gets written — as the legacy path, so
      // it is not re-read on every resume and the NULL count means "not yet processed".
      const values = page.map((r) => [r.listing_key, pathFor(r) ?? `/properties/${r.listing_key}`]);
      nulls += page.filter((r) => pathFor(r) === null).length;

      await c.query(
        `UPDATE listings t SET sitemap_path = v.path
           FROM (SELECT * FROM unnest($1::text[], $2::text[]) AS s(key, path)) AS v
          WHERE t.listing_key = v.key`,
        [values.map((v) => v[0]), values.map((v) => v[1])]
      );

      cursor = page[page.length - 1].listing_key;
      done += page.length;
      batches++;
      if (batches % VACUUM_EVERY === 0) {
        await c.query('VACUUM listings');
        const el = (Date.now() - t0) / 1000;
        console.log(`   ${n(done)} rows (${(done / el).toFixed(0)}/s) — vacuumed`);
      }
    }
    await c.query('VACUUM (ANALYZE) listings');

    const { rows: [post] } = await c.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE sitemap_path IS NULL)::int AS still_null,
             count(*) FILTER (WHERE sitemap_path LIKE '/property/%')::int AS canonical,
             count(*) FILTER (WHERE sitemap_path LIKE '/properties/%')::int AS legacy
      FROM listings`);

    console.log(`\n✅ backfilled ${n(done)} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.table([{ canonical: post.canonical, legacy_fallback: post.legacy, still_null: post.still_null }]);
    if (nulls > 0) console.log(`   ${n(nulls)} payload(s) could not form a slug — they ship under /properties/{KEY}`);

    if (post.still_null > 0) {
      console.error(`\n❌ ${n(post.still_null)} rows still NULL — the sitemap would emit legacy paths for them.`);
      process.exit(1);
    }
    console.log(`   every one of ${n(post.total)} listings now carries a path.`);
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
