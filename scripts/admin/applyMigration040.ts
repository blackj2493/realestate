/**
 * Apply migration 040 (region_price_trend RPC) via the Session pooler.
 *
 * Instant DDL (a single CREATE OR REPLACE FUNCTION) — also safe to paste straight into
 * the Supabase SQL editor. This script is provided for parity with the other migrations.
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12). The direct host
 * (db.<ref>.supabase.co) no longer resolves over IPv4 from this env — use the pooler.
 *
 * Run: npx tsx scripts/admin/applyMigration040.ts
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
  console.log('\n🔧 Migration 040: region_price_trend RPC');
  console.log('============================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    const migrationPath = path.join(__dirname, '../../supabase/migrations/040_region_price_trend.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Creating function region_price_trend(...)...');
    const t0 = Date.now();
    await client.query(migrationSQL);
    console.log(`✅ Applied in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    // Smoke test: the function should return a JSONB object with points + summary.
    const { rows } = await client.query(
      `SELECT (region_price_trend('Brampton') -> 'points') IS NOT NULL AS ok,
              jsonb_array_length(region_price_trend('Brampton') -> 'points') AS months`
    );
    console.log(`   smoke test: ok=${rows[0].ok} months=${rows[0].months}`);
    if (!rows[0].ok) throw new Error('region_price_trend returned no points key');

    console.log('\n============================================');
    console.log('✅ Migration 040 Complete!');
    console.log('============================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string; code?: string };
    console.error('\n❌ Migration failed!');
    console.error('   Error:', e.message);
    console.error(error);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

applyMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
