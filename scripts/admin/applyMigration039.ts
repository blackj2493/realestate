// scripts/admin/applyMigration039.ts
/**
 * Apply Migration 039 (school_catchment_by_id RPC) via the Session pooler.
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 * Run: npx tsx scripts/admin/applyMigration039.ts
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
  console.log('\n🔧 Migration 039: school_catchment_by_id RPC');
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL');
    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/039_school_catchment_by_id.sql'),
      'utf-8'
    );
    await client.query(sql);
    const fn = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'school_catchment_by_id'`);
    if (fn.rows.length === 0) throw new Error('function school_catchment_by_id missing post-apply');
    console.log('✅ Migration 039 complete (school_catchment_by_id).');
  } finally {
    await client.end();
  }
}

applyMigration().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Migration failed:', e?.message || e);
  process.exit(1);
});
