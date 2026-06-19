/**
 * Apply migration 042 (Toronto district-code roll-up in region_price_trend +
 * region_active_aggregates) via the Session pooler.
 *
 * Instant DDL (two CREATE OR REPLACE FUNCTION) — also safe to paste into the SQL editor.
 *
 * Requires DATABASE_URL = Supabase Session pooler string. Run after 040/041.
 * Run: npx tsx scripts/admin/applyMigration042.ts
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
  console.log('\n🔧 Migration 042: Toronto district-code region match');
  console.log('============================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    const migrationPath = path.join(__dirname, '../../supabase/migrations/042_region_match_toronto_districts.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Replacing region_price_trend + region_active_aggregates...');
    const t0 = Date.now();
    await client.query(migrationSQL);
    console.log(`✅ Applied in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    // Smoke test: Toronto must now return data on both sides (was 0 before).
    const trend = await client.query(
      `SELECT jsonb_array_length(region_price_trend('Toronto') -> 'points') AS months`
    );
    const stats = await client.query(`SELECT active_count FROM region_active_aggregates('Toronto')`);
    console.log(`   Toronto smoke test: trend months=${trend.rows[0].months}, active_count=${stats.rows[0].active_count}`);
    if (!trend.rows[0].months || !stats.rows[0].active_count) {
      throw new Error('Toronto still returns no data after migration 042');
    }

    console.log('\n============================================');
    console.log('✅ Migration 042 Complete!');
    console.log('============================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string };
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
