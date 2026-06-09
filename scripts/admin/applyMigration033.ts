/**
 * Apply migration 033 (idx_listings_active_property_hash) via the Session pooler.
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12) — lives in
 * .env.local. The Supabase direct host (db.<ref>.supabase.co) is IPv6-only from this
 * env; if this fails with getaddrinfo ENOENT, set DATABASE_URL to the Session pooler.
 *
 * Run: npx tsx scripts/admin/applyMigration033.ts
 *
 * NOTE: this builds a partial index whose predicate detoasts full_payload across
 * ~136k rows — too heavy for the Supabase SQL editor (gateway timeout, §12). It is
 * built CONCURRENTLY (no ACCESS EXCLUSIVE lock on the hot `listings` table) with
 * statement_timeout disabled, so it must run from a pooler-connected script like this.
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
  console.log('\n🔧 Migration 033: idx_listings_active_property_hash (partial index)');
  console.log('============================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    // The CONCURRENTLY build scans + detoasts full_payload across ~136k rows; it can
    // exceed any finite statement_timeout on this IO-bound instance. Disable it (the
    // build runs without an exclusive lock, so a long build does not block readers).
    await client.query("SET statement_timeout TO '0'");

    const migrationPath = path.join(
      __dirname,
      '../../supabase/migrations/033_listings_active_property_hash_index.sql'
    );
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Building idx_listings_active_property_hash CONCURRENTLY (this can take several minutes)...');
    const t0 = Date.now();
    // Single autocommit statement — required for CREATE INDEX CONCURRENTLY.
    await client.query(migrationSQL);
    console.log(`✅ Build returned in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    // Verify the index exists AND is valid. A CONCURRENTLY build that is interrupted
    // leaves an INVALID index that silently won't be used — surface it explicitly.
    const { rows } = await client.query<{
      indisvalid: boolean;
      indisready: boolean;
    }>(
      `SELECT i.indisvalid, i.indisready
         FROM pg_class c
         JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = 'idx_listings_active_property_hash'`
    );

    if (rows.length === 0) {
      console.error('⚠️  Index idx_listings_active_property_hash not found after build.');
      throw new Error('index missing post-build');
    }
    const { indisvalid, indisready } = rows[0];
    console.log(`   indisvalid=${indisvalid} indisready=${indisready}`);
    if (!indisvalid) {
      console.error(
        '\n❌ Index is INVALID (an interrupted CONCURRENTLY build). Drop and rebuild:\n' +
          "   DROP INDEX CONCURRENTLY IF EXISTS idx_listings_active_property_hash;\n" +
          '   then re-run this script.'
      );
      throw new Error('index invalid');
    }

    console.log('\n============================================');
    console.log('✅ Migration 033 Complete! (index valid)');
    console.log('============================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string; code?: string };
    console.error('\n❌ Migration failed!');
    console.error('   Error:', e.message);
    if (e.code === 'ECONNREFUSED') {
      console.error('   → Connection refused. Check DATABASE_URL and network access.');
    } else if (e.code === '28P01') {
      console.error('   → Authentication failed. Check credentials in DATABASE_URL.');
    } else if (e.code === '25001') {
      console.error('   → CONCURRENTLY ran inside a transaction block. Ensure the .sql has a single statement.');
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
