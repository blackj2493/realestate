/**
 * Apply Migration 015: Auth profiles + cross-device watchlist.
 *
 * Creates public.profiles and public.watchlist (RLS owner-only), plus the
 * on_auth_user_created trigger that seeds a profile on signup. New tables only —
 * does NOT touch raw_vow_sold / listings (CLAUDE.md §12).
 *
 * Run: npx tsx scripts/admin/applyMigration015.ts
 * Needs DATABASE_URL (the direct postgres connection string — the trigger on
 * auth.users requires the owner role, which DATABASE_URL provides).
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

async function applyMigration() {
  console.log('\n🔧 Migration 015: Auth profiles + watchlist');
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
      '../../supabase/migrations/015_auth_profiles_watchlist.sql'
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration SQL (profiles, watchlist, RLS, signup trigger)...');
    await client.query(migrationSQL);
    console.log('✅ Migration applied successfully!\n');

    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('profiles', 'watchlist')
      ORDER BY table_name;
    `);
    console.log('📊 Tables present:');
    for (const t of tables.rows) console.log(`   ✅ public.${t.table_name}`);

    const trig = await client.query(`
      SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';
    `);
    console.log(
      trig.rows.length > 0
        ? '   ✅ trigger on_auth_user_created'
        : '   ⚠️  trigger on_auth_user_created not found'
    );

    console.log('\n============================================');
    console.log('✅ Migration 015 Complete!');
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
