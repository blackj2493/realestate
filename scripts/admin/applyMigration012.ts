/**
 * Shadow MLS — Apply migration 012 (condo_fee_stats).
 *
 * Reads supabase/migrations/012_create_condo_fee_stats.sql and executes it against
 * Supabase Postgres via a direct `pg` connection (DIRECT_DB_URL). The migration is
 * idempotent (CREATE TABLE/INDEX IF NOT EXISTS, DROP TRIGGER IF EXISTS) so re-runs
 * are safe. Does NOT touch raw_vow_sold.
 *
 * Run: npx tsx --env-file=.env scripts/admin/applyMigration012.ts
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const DIRECT_DB_URL = (process.env.DIRECT_DB_URL || '').trim();
if (!DIRECT_DB_URL) {
  console.error('❌ DIRECT_DB_URL not found in environment');
  process.exit(1);
}

const SQL_FILE = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '012_create_condo_fee_stats.sql'
);

async function main() {
  console.log('\n🔧 Apply migration 012 — condo_fee_stats');
  console.log('========================================\n');

  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const client = new Client({
    connectionString: DIRECT_DB_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('   ✅ Connected to Postgres');

    await client.query(sql);
    console.log('   ✅ Migration SQL executed');

    const reg = await client.query(`SELECT to_regclass('public.condo_fee_stats') AS t;`);
    console.log(`   🔍 condo_fee_stats → ${reg.rows[0].t ?? 'NOT FOUND'}`);

    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'condo_fee_stats' ORDER BY ordinal_position;`
    );
    console.log(`   📋 columns: ${cols.rows.map((r) => r.column_name).join(', ')}`);

    const idx = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'condo_fee_stats';`
    );
    console.log(`   📊 indexes: ${idx.rows.map((r) => r.indexname).join(', ')}`);

    console.log('\n✅ Migration 012 complete.\n');
  } catch (err: any) {
    console.error('\n❌ Migration failed:', err.message);
    throw err;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.');
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
