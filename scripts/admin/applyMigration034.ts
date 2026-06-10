// scripts/admin/applyMigration034.ts
/**
 * Apply migration 034 (raw_vow_delisted slim archive) via the Session pooler.
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md section 12).
 * The direct host (db.<ref>.supabase.co) is IPv6-only from this env. Light DDL —
 * also safe to paste into the Supabase SQL editor if preferred.
 *
 * Run: npx tsx scripts/admin/applyMigration034.ts
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
  console.log('\n🔧 Migration 034: raw_vow_delisted (slim de-listed archive)');
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL');
    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/034_raw_vow_delisted.sql'),
      'utf-8'
    );
    await client.query(sql);

    const { rows } = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'raw_vow_delisted'`
    );
    if (rows.length === 0) throw new Error('table missing post-apply');
    if (!rows[0].relrowsecurity) throw new Error('RLS not enabled on raw_vow_delisted');
    console.log('✅ Migration 034 complete (table exists, RLS enabled).');
  } finally {
    await client.end();
  }
}

applyMigration().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Migration failed:', e?.message || e);
  process.exit(1);
});
