/**
 * Backfill + indexes for Migration 020 (Region Scorecard).
 *
 * The heavy half of migration 020, kept OUT of the .sql so it doesn't hit the Supabase
 * SQL-editor gateway timeout. Runs over a direct `pg` connection with statement_timeout
 * disabled, in resumable id-cursor batches:
 *
 *   1. Backfill listings.extrapolated_cap_rate (Node ProForma engine — §4 keeps cap-rate
 *      computation in Node) AND listings.city_region (denormalized full_payload->>CityRegion).
 *   2. Build the indexes the RPC needs (lower(city), lower(city_region), and two partial
 *      active-inventory indexes whose JSONB-status predicate is too slow to build inline).
 *
 * Idempotent / resumable: only touches rows still missing a value; indexes use IF NOT EXISTS.
 * Safe to re-run after a timeout. Run off-peak (one-time, detoasts full_payload — IO budget).
 *
 * Run: npx tsx scripts/admin/backfill020.ts
 * Needs DATABASE_URL or DIRECT_DB_URL (session pooler if the direct host is IPv6-only).
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import { calculateProForma } from '../../src/lib/typesense/ExtrapolatedCapRateEngine';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
const CHUNK = 1000;

const NON_ACTIVE =
  "('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')";
const ACTIVE_PREDICATE =
  `lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', '')) NOT IN ${NON_ACTIVE}`;

if (!DATABASE_URL) {
  console.error('❌ No connection string found (set DATABASE_URL or DIRECT_DB_URL)');
  process.exit(1);
}

async function main() {
  console.log('\n🔧 Backfill 020: extrapolated_cap_rate + city_region (+ indexes)');
  console.log('==================================================================\n');

  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });
  await client.connect();
  console.log('   ✅ Connected');
  // No gateway here, but raise the session limit so the long index builds can't time out.
  await client.query("SET statement_timeout TO '0'");
  console.log('   ✅ statement_timeout disabled for this session\n');

  try {
    // ── 1. Batched column backfill (resumable by id cursor) ───────────────────────────
    console.log('📝 Backfilling columns (batches of', CHUNK + ')...');
    let lastId = '00000000-0000-0000-0000-000000000000';
    let total = 0;
    let batches = 0;

    for (;;) {
      const { rows } = await client.query(
        `SELECT id, list_price, full_payload->>'CityRegion' AS city_region
         FROM listings
         WHERE (extrapolated_cap_rate IS NULL OR city_region IS NULL)
           AND id > $1
         ORDER BY id
         LIMIT $2`,
        [lastId, CHUNK]
      );
      if (rows.length === 0) break;

      const params: (string | number | null)[] = [];
      const tuples: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const lp = Number(rows[i].list_price);
        // Cap rate only where priced; NULL otherwise (excluded from the aggregate, not 0).
        const cr = Number.isFinite(lp) && lp > 0 ? calculateProForma(lp).extrapolated_cap_rate : null;
        const cregion = (rows[i].city_region as string | null) ?? null;
        const b = i * 3;
        params.push(rows[i].id as string, cr, cregion);
        tuples.push(`($${b + 1}::uuid, $${b + 2}::numeric, $${b + 3}::varchar)`);
      }

      await client.query(
        `UPDATE listings AS l
         SET extrapolated_cap_rate = coalesce(l.extrapolated_cap_rate, v.cr),
             city_region          = coalesce(l.city_region, v.cregion)
         FROM (VALUES ${tuples.join(',')}) AS v(id, cr, cregion)
         WHERE l.id = v.id`,
        params
      );

      total += rows.length;
      batches++;
      lastId = rows[rows.length - 1].id as string;
      if (batches % 10 === 0) console.log(`   … ${total.toLocaleString()} rows processed`);
    }
    console.log(`   ✅ Columns backfilled: ${total.toLocaleString()} rows in ${batches} batches\n`);

    // ── 2. Indexes (built after backfill so they're populated; non-gateway = no timeout) ─
    console.log('📝 Building indexes (this detoasts full_payload once — may take a minute)...');
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_listings_city_lower ON listings (lower(city));`
    );
    console.log('   ✅ idx_listings_city_lower');
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_listings_city_region_lower ON listings (lower(city_region));`
    );
    console.log('   ✅ idx_listings_city_region_lower');
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_listings_active_city_lower
         ON listings (lower(city)) WHERE ${ACTIVE_PREDICATE};`
    );
    console.log('   ✅ idx_listings_active_city_lower (partial)');
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_listings_active_cityregion_lower
         ON listings (lower(city_region)) WHERE ${ACTIVE_PREDICATE};`
    );
    console.log('   ✅ idx_listings_active_cityregion_lower (partial)');

    console.log('\n==================================================================');
    console.log('✅ Backfill 020 complete. Try: SELECT * FROM region_active_aggregates(\'Oakville\');');
    console.log('==================================================================\n');
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('\n❌ Backfill failed:', e.message);
    console.error('   (Safe to re-run — column backfill resumes, indexes use IF NOT EXISTS.)');
    throw err;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
