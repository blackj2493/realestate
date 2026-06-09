/**
 * Apply migration 032 (property_campaign_history) via the Session pooler.
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12) — lives in .env.local.
 * Run: npx tsx scripts/admin/applyMigration032.ts
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
  console.log('\n🔧 Migration 032: property_campaign_history ledger table');
  console.log('============================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    await client.query("SET statement_timeout TO '60000'");

    const migrationPath = path.join(
      __dirname,
      '../../supabase/migrations/032_create_property_campaign_history.sql'
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration SQL (create property_campaign_history + trigger)...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');

    const { rows } = await client.query(
      "SELECT to_regclass('public.property_campaign_history') AS tbl"
    );
    console.log(`   ${rows[0].tbl ? '✅' : '⚠️ '} property_campaign_history = ${rows[0].tbl}`);

    console.log('\n============================================');
    console.log('✅ Migration 032 Complete!');
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
