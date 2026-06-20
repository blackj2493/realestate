/**
 * Apply Migration 043: basement filter for the Region Scorecard + price-trend RPCs.
 *
 * Recreates region_active_aggregates (6→7 args) and region_price_trend (7→8 args), each
 * with a trailing optional `p_basement text DEFAULT 'any'` (any | finished | unfinished).
 * Instant DDL only — no table writes, no index builds, raw_vow_sold untouched (§12).
 *
 * Run: npx tsx scripts/admin/applyMigration043.ts
 * Needs the postgres connection string in DATABASE_URL or DIRECT_DB_URL.
 * NOTE: the Supabase direct host (db.<ref>.supabase.co) is IPv6-only from this env —
 * if this fails with getaddrinfo ENOENT, use the Session pooler string as
 * DATABASE_URL, or paste the .sql into the Supabase SQL editor instead.
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

async function applyMigration() {
  console.log('\n🔧 Migration 043: Region aggregates + price-trend — basement filter');
  console.log('============================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    const migrationPath = path.join(
      __dirname,
      '../../supabase/migrations/043_region_aggregates_basement.sql'
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration SQL (recreate both RPCs with p_basement)...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');

    // Confirm the new overloads exist (7-arg active, 8-arg trend).
    for (const fn of ['region_active_aggregates', 'region_price_trend']) {
      const r = await client.query(
        `SELECT pg_get_function_identity_arguments(oid) AS args
         FROM pg_proc WHERE proname = $1 ORDER BY args;`,
        [fn]
      );
      console.log(`📊 ${fn} overloads:`);
      for (const row of r.rows) console.log(`   • (${row.args})`);
      const hasBasement = r.rows.some((row: { args: string }) =>
        / text$/.test(row.args) || /, text$/.test(row.args)
      );
      console.log(hasBasement ? '   ✅ p_basement overload present\n' : '   ⚠️  p_basement overload missing\n');
    }

    // Smoke test: Oakville, all vs finished vs unfinished (active stats + sold trend sales90).
    const active = await client.query(
      `SELECT
         (region_active_aggregates('Oakville')).active_count                                          AS any_active,
         (region_active_aggregates('Oakville', NULL, 0, 0, 0, 0, 'finished')).active_count            AS fin_active,
         (region_active_aggregates('Oakville', NULL, 0, 0, 0, 0, 'unfinished')).active_count          AS unf_active`
    );
    const trend = await client.query(
      `SELECT
         region_price_trend('Oakville')                                  -> 'summary' ->> 'sales90' AS any_sales90,
         region_price_trend('Oakville', NULL, 0, 0, 0, 0, 24, 'finished')   -> 'summary' ->> 'sales90' AS fin_sales90,
         region_price_trend('Oakville', NULL, 0, 0, 0, 0, 24, 'unfinished') -> 'summary' ->> 'sales90' AS unf_sales90`
    );
    console.log('🔎 Oakville smoke test:');
    console.log('   active_count  any/fin/unf :', active.rows[0]);
    console.log('   sold sales90  any/fin/unf :', trend.rows[0]);

    console.log('\n============================================');
    console.log('✅ Migration 043 Complete!');
    console.log('============================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string; code?: string };
    console.error('\n❌ Migration failed!');
    console.error('   Error:', e.message);
    if (e.code === 'ECONNREFUSED') {
      console.error('   → Connection refused. Check DATABASE_URL and network access.');
    } else if (e.code === '28P01') {
      console.error('   → Authentication failed. Check credentials in DATABASE_URL.');
    }
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

applyMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
