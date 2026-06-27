/**
 * Repair the migration-047 CountyOrParish expression indexes.
 *
 * region_active_aggregates / region_price_trend each have a `lower(payload->>'CountyOrParish')`
 * region branch (Ottawa roll-up). Without a matching expression index that predicate forces a
 * full-table jsonb DETOAST → seq scan (Toronto base call measured ~43–53s, near the 60s
 * statement_timeout). applyMigration047.ts was supposed to create these `CONCURRENTLY IF NOT
 * EXISTS`, but a missing/INVALID (interrupted) build leaves them unusable — and IF NOT EXISTS
 * then refuses to rebuild by name. This script checks validity and rebuilds only what's broken.
 *
 * SAFE ON LIVE: CREATE/DROP INDEX CONCURRENTLY take no table lock. The one-time build detoasts
 * the jsonb once, so statement_timeout is disabled for the session. raw_vow_sold stays
 * read-only (CLAUDE.md §12) — an index is not a data mutation (migration 047 created it too).
 *
 * Requires DATABASE_URL (Session pooler) or DIRECT_DB_URL.
 * Run: npx tsx scripts/admin/rebuildCountyIndex.ts
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) {
  console.error('❌ No connection string (set DATABASE_URL or DIRECT_DB_URL)');
  process.exit(1);
}

const INDEXES = [
  { name: 'idx_listings_county_lower', create: `CREATE INDEX CONCURRENTLY idx_listings_county_lower ON listings (lower(full_payload->>'CountyOrParish'))` },
  { name: 'idx_vow_sold_county_lower', create: `CREATE INDEX CONCURRENTLY idx_vow_sold_county_lower ON raw_vow_sold (lower(raw_payload->>'CountyOrParish'))` },
];

async function main() {
  console.log('\n🔧 Rebuild migration-047 CountyOrParish indexes');
  console.log('================================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('   ✅ Connected\n');

  try {
    // CONCURRENTLY can't run under a statement_timeout (one-time full-table detoast).
    await client.query('SET statement_timeout = 0');

    for (const ix of INDEXES) {
      const { rows } = await client.query(
        `SELECT i.indisvalid AS valid
           FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
          WHERE c.relname = $1`,
        [ix.name]
      );
      const state = rows.length === 0 ? 'MISSING' : rows[0].valid ? 'VALID' : 'INVALID';
      console.log(`📑 ${ix.name}: ${state}`);

      if (state === 'VALID') {
        console.log('   → already healthy, skipping.\n');
        continue;
      }
      if (state === 'INVALID') {
        console.log('   → dropping the invalid leftover…');
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${ix.name}`);
      }
      console.log('   → building CONCURRENTLY (one-time detoast — may take a minute)…');
      const t0 = Date.now();
      await client.query(ix.create);
      console.log(`   ✅ built in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    }

    // Refresh planner stats so it picks the new indexes immediately.
    console.log('📊 ANALYZE listings, raw_vow_sold…');
    await client.query('ANALYZE listings');
    await client.query('ANALYZE raw_vow_sold');

    console.log('\n================================================');
    console.log('✅ County indexes healthy. The region RPCs (and the nightly');
    console.log('   market-summary refresh) should now run in seconds, not ~50s.');
    console.log('================================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('\n❌ Failed:', e.message);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1));
