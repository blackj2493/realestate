/**
 * Apply Migration 031: de-fake the Region Scorecard cap rate.
 *
 * Adds listings.cap_rate_est (real IDX-derived cap) and CREATE OR REPLACEs
 * region_active_aggregates to aggregate it within the [1,15]% sanity band instead of
 * the fabricated extrapolated_cap_rate. Instant DDL only — no table writes, no index
 * builds, raw_vow_sold untouched (§12). Then run scripts/admin/backfill031.ts --apply.
 *
 * Run: npx tsx scripts/admin/applyMigration031.ts
 * Needs the postgres connection string in DATABASE_URL or DIRECT_DB_URL.
 * NOTE: the Supabase direct host (db.<ref>.supabase.co) is IPv6-only from this env —
 * if this fails with getaddrinfo ENOENT, use the Session pooler string as DATABASE_URL,
 * or paste the .sql into the Supabase SQL editor instead (§12).
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
  console.log('\n🔧 Migration 031: Region Scorecard cap rate → real cap_rate_est + band');
  console.log('============================================\n');

  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });

  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    const migrationPath = path.join(__dirname, '../../supabase/migrations/031_region_cap_rate_est.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration SQL (add cap_rate_est column + recreate RPC)...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');

    // Confirm the column exists.
    const col = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'listings' AND column_name = 'cap_rate_est'
    `);
    console.log(col.rowCount ? '   ✅ listings.cap_rate_est column present' : '   ⚠️  column missing');

    // Smoke test (will read all-NULL caps until backfill031 runs — expect cap_sample 0).
    const all = await client.query(`SELECT * FROM region_active_aggregates('Oakville')`);
    console.log('\n🔎 Oakville (pre-backfill, cap_sample should be 0 until backfill031):');
    console.log('   ', all.rows[0]);

    console.log('\n============================================');
    console.log('✅ Migration 031 Complete! Next: npx tsx scripts/admin/backfill031.ts --apply');
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
