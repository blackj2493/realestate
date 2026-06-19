// scripts/admin/applyMigration038.ts
/**
 * Apply Migration 038 (school_catchments — partial GIST + school_catchments_in_bbox
 * RPC) via the Session pooler. Light DDL — also safe to paste into the Supabase SQL
 * editor. Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 *
 * Run: npx tsx scripts/admin/applyMigration038.ts
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
  console.log('\n🔧 Migration 038: school_catchments (bbox RPC + partial GIST)');
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL');
    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/038_school_catchments.sql'),
      'utf-8'
    );
    await client.query(sql);

    const fn = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'school_catchments_in_bbox'`);
    if (fn.rows.length === 0) throw new Error('function school_catchments_in_bbox missing post-apply');

    console.log('✅ Migration 038 complete (school_catchments_in_bbox + partial GIST on geo_features).');
  } finally {
    await client.end();
  }
}

applyMigration().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Migration failed:', e?.message || e);
  process.exit(1);
});
