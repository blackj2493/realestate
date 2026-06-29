/**
 * Apply migration 048 (market_summary table) via the Session pooler.
 *
 * Creates the precompute table the leaderboard/scorecard read from. Pure DDL (instant,
 * idempotent — CREATE TABLE IF NOT EXISTS + ENABLE RLS). After this, run
 *   npx tsx scripts/admin/refresh-market-summary.ts --apply
 * once to populate it (the nightly sync keeps it fresh thereafter).
 *
 * Requires DATABASE_URL = Supabase Session pooler string (or DIRECT_DB_URL).
 * Run: npx tsx scripts/admin/applyMigration048.ts
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

async function main() {
  console.log('\n🔧 Migration 048: market_summary precompute table');
  console.log('==================================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('   ✅ Connected to PostgreSQL\n');

  try {
    const migrationPath = path.join(__dirname, '../../supabase/migrations/048_market_summary.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    console.log('📝 Creating market_summary…');
    const t0 = Date.now();
    await client.query(migrationSQL);
    console.log(`   ✅ Applied in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    const check = await client.query(
      `SELECT count(*)::int AS rows FROM market_summary`
    );
    console.log(`🔎 market_summary exists — ${check.rows[0].rows} rows (0 until the first refresh).`);
    console.log('\n==================================================');
    console.log('✅ Done. Populate it now with:');
    console.log('   npx tsx scripts/admin/refresh-market-summary.ts --apply');
    console.log('==================================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('\n❌ Migration failed:', e.message);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1));
