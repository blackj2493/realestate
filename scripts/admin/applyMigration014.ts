/**
 * Shadow MLS — Apply migration 014 (terminal_applications).
 *
 * Reads supabase/migrations/014_terminal_applications.sql and executes it against
 * Supabase Postgres via a direct `pg` connection (DIRECT_DB_URL). Idempotent
 * (CREATE TABLE/INDEX IF NOT EXISTS) so re-runs are safe. New table only — does NOT
 * touch raw_vow_sold.
 *
 * Run: npx tsx --env-file=.env scripts/admin/applyMigration014.ts
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
  '014_terminal_applications.sql'
);

async function main() {
  console.log('\n🔧 Apply migration 014 — terminal_applications');
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

    const reg = await client.query(`SELECT to_regclass('public.terminal_applications') AS t;`);
    console.log(`   🔍 terminal_applications → ${reg.rows[0].t ?? 'NOT FOUND'}`);

    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'terminal_applications' ORDER BY ordinal_position;`
    );
    console.log(`   📋 columns: ${cols.rows.map((r) => r.column_name).join(', ')}`);

    const rls = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'terminal_applications';`
    );
    console.log(`   🔒 RLS enabled: ${rls.rows[0]?.relrowsecurity}`);

    console.log('\n✅ Migration 014 complete.\n');
  } catch (err: unknown) {
    console.error('\n❌ Migration failed:', err instanceof Error ? err.message : err);
    throw err;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.');
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
