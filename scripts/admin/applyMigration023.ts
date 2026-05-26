/**
 * Apply Migration 023: create the property_estimates table.
 *
 * Instant DDL only (CREATE TABLE IF NOT EXISTS) — no table writes, no index builds,
 * raw_vow_sold untouched (§12). Safe to paste into the Supabase SQL editor instead.
 *
 * Run: npx tsx scripts/admin/applyMigration023.ts
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
  console.log('\n🔧 Migration 023: Create property_estimates table');
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
      '../../supabase/migrations/023_create_property_estimates.sql'
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration SQL (CREATE TABLE property_estimates)...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');

    const cols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'property_estimates'
      ORDER BY ordinal_position;
    `);
    console.log('📊 property_estimates columns:');
    for (const r of cols.rows) console.log(`   • ${r.column_name} (${r.data_type})`);

    console.log('\n============================================');
    console.log('✅ Migration 023 Complete!');
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
