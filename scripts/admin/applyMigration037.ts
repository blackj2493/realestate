// scripts/admin/applyMigration037.ts
/**
 * Apply Migration 037 (geo "Things to Know" — PostGIS reference + output tables)
 * via the Session pooler.
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12). The
 * direct host (db.<ref>.supabase.co) is IPv6-only from this env. Light DDL —
 * also safe to paste into the Supabase SQL editor if preferred.
 *
 * Run: npx tsx scripts/admin/applyMigration037.ts
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

const EXPECTED_TABLES = [
  'geo_floodplain',
  'geo_rail_lines',
  'geo_traffic_counts',
  'geo_sources',
  'listing_geo_flags',
];

async function applyMigration() {
  console.log('\n🔧 Migration 037: geo "Things to Know" (PostGIS + listing_geo_flags)');
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL');
    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/037_geo_things_to_know.sql'),
      'utf-8'
    );
    await client.query(sql);

    // Verify PostGIS is enabled.
    const ext = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'postgis'`);
    if (ext.rows.length === 0) throw new Error('postgis extension not enabled post-apply');

    // Verify all five tables exist.
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
      [EXPECTED_TABLES]
    );
    const found = new Set(rows.map((r) => r.tablename as string));
    const missing = EXPECTED_TABLES.filter((t) => !found.has(t));
    if (missing.length) throw new Error(`tables missing post-apply: ${missing.join(', ')}`);

    console.log(`✅ Migration 037 complete (postgis enabled, ${EXPECTED_TABLES.length} tables + GIST indexes).`);
  } finally {
    await client.end();
  }
}

applyMigration().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Migration failed:', e?.message || e);
  process.exit(1);
});
