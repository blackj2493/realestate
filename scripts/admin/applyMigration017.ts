/**
 * Apply Migration 017: Saveable underwriting scenarios (P6 Underwriting Sandbox).
 *
 * Creates public.underwriting_scenarios (owner-only RLS via auth.uid()). New table
 * only — does NOT touch raw_vow_sold / listings / sync_state (CLAUDE.md §12).
 *
 * Run: npx tsx scripts/admin/applyMigration017.ts
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
  console.log('\n🔧 Migration 017: Underwriting scenarios');
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
      '../../supabase/migrations/017_underwriting_scenarios.sql'
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration SQL (underwriting_scenarios table, index, RLS)...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');

    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'underwriting_scenarios';
    `);
    console.log('📊 Tables present:');
    for (const t of tables.rows) console.log(`   ✅ public.${t.table_name}`);

    const rls = await client.query(`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'underwriting_scenarios';
    `);
    console.log(
      rls.rows[0]?.relrowsecurity
        ? '   ✅ RLS enabled (owner-only via auth.uid())'
        : '   ⚠️  RLS not enabled'
    );

    console.log('\n============================================');
    console.log('✅ Migration 017 Complete!');
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
