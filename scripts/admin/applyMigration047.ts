/**
 * Apply migration 047 (CountyOrParish region roll-up — fixes Ottawa) via the Session pooler.
 *
 * Two parts, in order:
 *   1. CREATE INDEX CONCURRENTLY on lower(CountyOrParish) for raw_vow_sold + listings. These
 *      CANNOT live in the .sql DDL batch (CONCURRENTLY forbids a txn block) and the build must
 *      run with statement_timeout disabled (it detoasts the jsonb once). CONCURRENTLY = no
 *      table lock, so it is safe to run on live prod. IF NOT EXISTS ⇒ idempotent/re-runnable.
 *   2. Apply 047_region_county_rollup.sql (the two CREATE OR REPLACE FUNCTION statements).
 *
 * Then smoke-test: region_price_trend('Ottawa') must now return >0 monthly points, and
 * region_active_aggregates('Ottawa') a non-zero active_count — while Mississauga (a two-tier
 * city) must be UNCHANGED (no county false-match).
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 * Run: npx tsx scripts/admin/applyMigration047.ts
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) {
  console.error('❌ No connection string found (set DATABASE_URL or DIRECT_DB_URL)');
  process.exit(1);
}

const INDEXES = [
  {
    name: 'idx_vow_sold_county_lower',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vow_sold_county_lower
            ON raw_vow_sold (lower(raw_payload->>'CountyOrParish'))`,
  },
  {
    name: 'idx_listings_county_lower',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_county_lower
            ON listings (lower(full_payload->>'CountyOrParish'))`,
  },
];

async function main() {
  console.log('\n🔧 Migration 047: CountyOrParish region roll-up (fixes Ottawa)');
  console.log('==============================================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('   ✅ Connected to PostgreSQL\n');

  try {
    // 1) Expression indexes — concurrent, timeout disabled (one-time jsonb detoast per row).
    await client.query('SET statement_timeout = 0');
    for (const ix of INDEXES) {
      console.log(`📑 Building ${ix.name} (CONCURRENTLY)…`);
      const t0 = Date.now();
      await client.query(ix.sql);
      console.log(`   ✅ ${ix.name} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    }

    // 2) Function bodies.
    const migrationPath = path.join(__dirname, '../../supabase/migrations/047_region_county_rollup.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    console.log('📝 Replacing region_price_trend + region_active_aggregates…');
    const t1 = Date.now();
    await client.query(migrationSQL);
    console.log(`   ✅ Functions replaced in ${((Date.now() - t1) / 1000).toFixed(1)}s\n`);

    // 3) Smoke tests.
    console.log('🔎 Smoke tests:');
    const ott = await client.query(
      `SELECT jsonb_array_length(region_price_trend('Ottawa') -> 'points') AS months,
              (region_price_trend('Ottawa') #>> '{summary,sales90}')        AS sales90`);
    const ottActive = await client.query(`SELECT active_count FROM region_active_aggregates('Ottawa')`);
    const miss = await client.query(
      `SELECT jsonb_array_length(region_price_trend('Mississauga') -> 'points') AS months`);
    console.log(`   Ottawa  sold months  = ${ott.rows[0].months} (expect >0), 90d sales = ${ott.rows[0].sales90}`);
    console.log(`   Ottawa  active_count = ${ottActive.rows[0].active_count} (expect >0)`);
    console.log(`   Mississauga months   = ${miss.rows[0].months} (control — unchanged, two-tier city)`);

    if (!ott.rows[0].months || ott.rows[0].months === 0) {
      throw new Error('Ottawa still returns 0 months — fix did not take.');
    }

    console.log('\n==============================================================');
    console.log('✅ Migration 047 complete. Bump the unstable_cache versions in');
    console.log('   src/lib/market/aggregates.ts so Ottawa refreshes immediately (else ≤24h).');
    console.log('==============================================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('\n❌ Migration failed:', e.message);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1));
