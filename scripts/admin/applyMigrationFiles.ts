// scripts/admin/applyMigrationFiles.ts
/**
 * Apply one or more migration files (by filename) via the Session pooler, in order.
 * Additive DDL / CREATE OR REPLACE only — no transaction wrapper across files so a
 * later failure leaves earlier (idempotent) files applied. Requires DATABASE_URL.
 *
 * Usage: npx tsx scripts/admin/applyMigrationFiles.ts 064_foo.sql 065_bar.sql
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

const files = process.argv.slice(2);
if (files.length === 0) { console.error('❌ Pass at least one migration filename'); process.exit(1); }

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ connected');
  try {
    for (const f of files) {
      const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations', f), 'utf-8');
      const t = Date.now();
      await client.query(sql);
      console.log(`✅ applied ${f} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    }
  } finally {
    await client.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
