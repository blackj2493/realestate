/**
 * How wide is the seller opt-out gap? — read-only census.
 *
 * Context: an owner asked for 188 Maplehurst Avenue to be removed. Their agent set
 * "Distribute to Internet" to No on one of three keys, and the page stayed live,
 * because nothing in this codebase reads the field. This script asks the only
 * question that sets the priority: is that one owner, or the whole book?
 *
 *   InternetEntireListingDisplayYN  "Distribute to Internet"      → the listing page
 *   InternetAddressDisplayYN        "Display Address on Internet" → the /address page
 *
 * A row only matters if it can still be SERVED. getListingDetail reads Supabase
 * `listings`, so an opted-out row there is a live listing page regardless of the
 * search index. `raw_vow_sold` feeds the sold_listings collection behind /address.
 *
 * Reads only. Direct pg (the flags are inside jsonb — PostgREST would time out).
 * Run: npx.cmd tsx --env-file=.env scripts/admin/_countInternetDisplayOptOuts.ts
 */
import pg from 'pg';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Supabase pooler cert, as probe-lar

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(`set statement_timeout = '600s'`);

  console.log('\n=== listings — the table getListingDetail serves from ===');
  const a = await c.query(`
    select
      count(*)                                                                    as rows_total,
      count(*) filter (where full_payload->>'InternetEntireListingDisplayYN' = 'false') as display_off,
      count(*) filter (where full_payload->>'InternetEntireListingDisplayYN' = 'true')  as display_on,
      count(*) filter (where full_payload->>'InternetEntireListingDisplayYN' is null)   as display_absent,
      count(*) filter (where full_payload->>'InternetAddressDisplayYN' = 'false')       as address_off,
      count(*) filter (where full_payload->>'InternetAddressDisplayYN' is null)         as address_absent
    from listings`);
  console.table(a.rows);

  console.log('\n=== listings with "Distribute to Internet" = No, by status ===');
  const b = await c.query(`
    select coalesce(standard_status,'(none)') as standard_status,
           is_orphaned,
           count(*) as n
    from listings
    where full_payload->>'InternetEntireListingDisplayYN' = 'false'
    group by 1,2
    order by n desc
    limit 30`);
  console.table(b.rows);

  console.log('\n=== sample of opted-out listings (a live page each) ===');
  const s = await c.query(`
    select listing_key, norm_address, standard_status, is_orphaned,
           to_char(updated_at,'YYYY-MM-DD') as updated
    from listings
    where full_payload->>'InternetEntireListingDisplayYN' = 'false'
    order by updated_at desc
    limit 25`);
  console.table(s.rows);

  console.log('\n=== raw_vow_sold — feeds sold_listings behind the /address page ===');
  const d = await c.query(`
    select
      count(*)                                                                   as rows_total,
      count(*) filter (where raw_payload->>'InternetEntireListingDisplayYN' = 'false') as display_off,
      count(*) filter (where raw_payload->>'InternetAddressDisplayYN' = 'false')       as address_off
    from raw_vow_sold`);
  console.table(d.rows);

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
