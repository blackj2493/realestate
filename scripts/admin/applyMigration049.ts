// scripts/admin/applyMigration049.ts
/**
 * Apply Migration 049 (enable RLS on all public tables) via the Session pooler.
 *
 * Fixes the Supabase advisor `rls_disabled_in_public` Critical finding by
 * enabling Row-Level Security (deny-all, service-role-only) on every public base
 * table that lacks it. See supabase/migrations/049_enable_rls_all_public_tables.sql.
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12). The
 * direct host (db.<ref>.supabase.co) is IPv6-only from this env. Catalog-only
 * DDL — also safe to paste straight into the Supabase SQL editor if preferred.
 *
 * Run: npx tsx scripts/admin/applyMigration049.ts
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
  console.log('\n🔧 Migration 049: enable RLS on all public tables (security fix)');
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL');

    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/049_enable_rls_all_public_tables.sql'),
      'utf-8'
    );
    await client.query(sql);

    // Verify: no public base table should have RLS disabled anymore
    // (spatial_ref_sys is a PostGIS extension table and is excluded by design).
    const { rows } = await client.query(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relrowsecurity = false
          AND c.relname <> 'spatial_ref_sys'
        ORDER BY c.relname`
    );

    if (rows.length > 0) {
      const names = rows.map((r: { relname: string }) => r.relname).join(', ');
      throw new Error(`RLS still disabled on: ${names}`);
    }

    console.log('✅ Migration 049 complete — every public table now has RLS enabled.');
  } finally {
    await client.end();
  }
}

applyMigration().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Migration failed:', e?.message || e);
  process.exit(1);
});
