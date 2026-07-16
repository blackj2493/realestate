// scripts/admin/applyMigration056.ts
/**
 * Apply Migration 056 (region_dom_distribution — Tier-1 True-DoM aggregate) via the
 * Session pooler. Additive DDL (a new function; region_active_aggregates untouched).
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 *
 * Run: npx tsx scripts/admin/applyMigration056.ts
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
  console.log('\n🔧 Migration 056: region_dom_distribution (True-DoM aggregate)');
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL');
    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/056_region_dom_distribution.sql'),
      'utf-8'
    );
    await client.query(sql);

    const fn = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'region_dom_distribution'`);
    if (fn.rows.length === 0) throw new Error('function region_dom_distribution missing post-apply');

    // Smoke test against Brampton (reads flat true_dom; real numbers await the backfill).
    const r = await client.query(
      `SELECT * FROM region_dom_distribution('Brampton', NULL, 0, 0, 0, 0, 'any')`
    );
    console.log('   smoke test — Brampton:', JSON.stringify(r.rows[0]));
    console.log('✅ Migration 056 complete.');
  } finally {
    await client.end();
  }
}

applyMigration().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Migration failed:', e?.message || e);
  process.exit(1);
});
