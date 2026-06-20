/**
 * READ-ONLY probe for the active-side basement filter (migration 043 fix).
 * Confirms the full_payload column type, whether listings carries basement_tier,
 * the real raw `Basement` token distribution, and that a JSON-array-containment
 * predicate returns sensible finished/unfinished counts.
 *
 * Run: npx tsx scripts/admin/probeBasement.ts [region]   (default: Oakville — not Toronto-split)
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
const REGION = process.argv[2] || 'Oakville';
if (!DATABASE_URL) { console.error('❌ No connection string'); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });
  await c.connect();
  console.log(`\n✅ Connected — probing basement data for ${REGION} (read-only)\n`);
  try {
    // 1. full_payload column type (json vs jsonb — gates the ?| / ? operators).
    const col = await c.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'listings' AND column_name = 'full_payload'`
    );
    console.log('full_payload type:', col.rows[0]?.data_type ?? '(not found)');

    // 2. Does listings carry a flat basement_tier (like raw_vow_sold)? (alt strategy)
    const bt = await c.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'listings' AND column_name = 'basement_tier'`
    );
    console.log('listings.basement_tier column:', bt.rows.length ? 'YES' : 'no');

    // 3. Raw Basement token distribution (top 25) for the region's active set.
    const tokens = await c.query(
      `SELECT elem, count(*) AS n
       FROM listings l,
            LATERAL jsonb_array_elements_text(
              CASE WHEN jsonb_typeof((l.full_payload->'Basement')::jsonb) = 'array'
                   THEN (l.full_payload->'Basement')::jsonb ELSE '[]'::jsonb END
            ) AS elem
       WHERE (lower(l.city) = lower($1) OR lower(l.city_region) = lower($1))
         AND l.list_price >= 50000
       GROUP BY elem ORDER BY n DESC LIMIT 25`,
      [REGION]
    );
    console.log('\nRaw Basement tokens (top 25):');
    for (const r of tokens.rows) console.log(`   ${String(r.n).padStart(6)}  ${r.elem}`);

    // 4. Containment counts: any / finished / unfinished via ?| and ? (jsonb operators).
    const counts = await c.query(
      `SELECT
         count(*) FILTER (WHERE list_price >= 50000)                                   AS any_c,
         count(*) FILTER (WHERE (full_payload->'Basement')::jsonb ?| array['Finished','Apartment','Finished with Walk-Out','Partially Finished']) AS fin_c,
         count(*) FILTER (WHERE (full_payload->'Basement')::jsonb ?  'Unfinished')      AS unf_c
       FROM listings
       WHERE (lower(city) = lower($1) OR lower(city_region) = lower($1))
         AND list_price >= 50000`,
      [REGION]
    );
    console.log(`\n${REGION} active counts  any/fin/unf:`, counts.rows[0]);
  } finally {
    await c.end();
    console.log('\n🔌 Connection closed.\n');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
