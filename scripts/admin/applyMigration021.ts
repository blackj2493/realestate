/**
 * Apply Migration 021: property-type filter for the Region Scorecard.
 *
 * Drops the single-arg region_active_aggregates(text) and recreates it as
 * region_active_aggregates(text, text[]) with an optional property-subtype filter.
 * Instant DDL only — no table writes, no index builds, raw_vow_sold untouched (§12).
 *
 * Run: npx tsx scripts/admin/applyMigration021.ts
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
  console.log('\n🔧 Migration 021: Region aggregates — property-type filter');
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
      '../../supabase/migrations/021_region_aggregates_by_type.sql'
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration SQL (drop + recreate region_active_aggregates RPC)...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');

    // Confirm the 2-arg overload exists and the 1-arg one is gone.
    const fn = await client.query(`
      SELECT pg_get_function_identity_arguments(oid) AS args
      FROM pg_proc WHERE proname = 'region_active_aggregates'
      ORDER BY args;
    `);
    console.log('📊 region_active_aggregates overloads:');
    for (const r of fn.rows) console.log(`   • (${r.args})`);
    const hasTwoArg = fn.rows.some((r: { args: string }) => r.args.includes('[]'));
    console.log(hasTwoArg ? '   ✅ (text, text[]) overload present' : '   ⚠️  2-arg overload missing');

    // Smoke test: all-types vs Detached for Oakville.
    const all = await client.query(`SELECT * FROM region_active_aggregates('Oakville')`);
    const det = await client.query(
      `SELECT * FROM region_active_aggregates('Oakville', ARRAY['Detached'])`
    );
    console.log('\n🔎 Oakville smoke test:');
    console.log('   all types :', all.rows[0]);
    console.log('   Detached  :', det.rows[0]);

    console.log('\n============================================');
    console.log('✅ Migration 021 Complete!');
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
