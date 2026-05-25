/**
 * Apply Migration 020: Region aggregates (Region Scorecard).
 *
 * Adds listings.extrapolated_cap_rate + listings.city_region (nullable), partial
 * active-inventory indexes, and the region_active_aggregates() RPC. Additive only —
 * does NOT touch raw_vow_sold (CLAUDE.md §12).
 *
 * Run: npx tsx scripts/admin/applyMigration020.ts
 *      (then: npx tsx scripts/admin/backfill020.ts)
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
  console.log('\n🔧 Migration 020: Region aggregates');
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
      '../../supabase/migrations/020_region_aggregates.sql'
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration SQL (columns, indexes, region_active_aggregates RPC)...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');

    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'listings'
        AND column_name IN ('extrapolated_cap_rate', 'city_region')
      ORDER BY column_name;
    `);
    console.log('📊 New columns on listings:');
    for (const c of cols.rows) console.log(`   ✅ ${c.column_name}`);

    const fn = await client.query(`
      SELECT proname FROM pg_proc WHERE proname = 'region_active_aggregates';
    `);
    console.log(
      fn.rows.length ? '   ✅ RPC region_active_aggregates() present' : '   ⚠️  RPC missing'
    );

    console.log('\n============================================');
    console.log('✅ Migration 020 Complete!');
    console.log('   Next: npx tsx scripts/admin/backfill020.ts');
    console.log('============================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string; code?: string };
    console.error('\n❌ Migration failed!');
    console.error('   Error:', e.message);
    if (e.code === 'ECONNREFUSED') {
      console.error('   → Connection refused. Check DATABASE_URL and network access.');
    } else if (e.code === '28P01') {
      console.error('   → Authentication failed. Check credentials in DATABASE_URL.');
    } else if (e.code === '42P07' || e.code === '42710') {
      console.error('   → Object already exists (this is OK — migration is idempotent).');
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
