/**
 * Apply migration 041 (raw_vow_sold lower(city)/lower(city_region) functional indexes)
 * via the Session pooler.
 *
 * The two indexes are built CONCURRENTLY (raw_vow_sold is upserted by the sync worker;
 * no ACCESS EXCLUSIVE lock). CREATE INDEX CONCURRENTLY cannot run inside a transaction
 * block, so each statement is issued separately with statement_timeout disabled — too
 * heavy / unsupported in the Supabase SQL editor (gateway timeout, §12).
 *
 * Requires DATABASE_URL = Supabase Session pooler string. The direct host
 * (db.<ref>.supabase.co) no longer resolves over IPv4 from this env — use the pooler.
 *
 * Run: npx tsx scripts/admin/applyMigration041.ts
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;

if (!DATABASE_URL) {
  console.error('❌ No connection string found (set DATABASE_URL or DIRECT_DB_URL)');
  process.exit(1);
}

const INDEXES: { name: string; ddl: string }[] = [
  {
    name: 'idx_vow_sold_city_lower_pcd',
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vow_sold_city_lower_pcd
            ON raw_vow_sold (lower(city), purchase_contract_date DESC)`,
  },
  {
    name: 'idx_vow_sold_cityregion_lower_pcd',
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vow_sold_cityregion_lower_pcd
            ON raw_vow_sold (lower(city_region), purchase_contract_date DESC)`,
  },
];

async function applyMigration() {
  console.log('\n🔧 Migration 041: raw_vow_sold case-insensitive region indexes');
  console.log('============================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    // CONCURRENTLY builds can exceed any finite statement_timeout on this IO-bound
    // instance; disable it (the build holds no exclusive lock, so readers are unaffected).
    await client.query("SET statement_timeout TO '0'");

    for (const { name, ddl } of INDEXES) {
      console.log(`📝 Building ${name} CONCURRENTLY...`);
      const t0 = Date.now();
      // Each CONCURRENTLY statement must be its own autocommit simple query.
      await client.query(ddl);
      console.log(`   ✅ returned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      // A CONCURRENTLY build that is interrupted leaves an INVALID index that is silently
      // never used — surface it so it can be dropped and rebuilt.
      const { rows } = await client.query<{ indisvalid: boolean }>(
        `SELECT i.indisvalid
           FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
          WHERE c.relname = $1`,
        [name]
      );
      if (rows.length === 0) throw new Error(`${name} not found after build`);
      if (!rows[0].indisvalid) {
        throw new Error(
          `${name} is INVALID (interrupted build). Run: DROP INDEX CONCURRENTLY IF EXISTS ${name}; then re-run.`
        );
      }
      console.log(`   indisvalid=${rows[0].indisvalid}\n`);
    }

    console.log('============================================');
    console.log('✅ Migration 041 Complete! (both indexes valid)');
    console.log('============================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string; code?: string };
    console.error('\n❌ Migration failed!');
    console.error('   Error:', e.message);
    if (e.code === '25001') {
      console.error('   → CONCURRENTLY ran inside a transaction block. Each statement must run on its own.');
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
