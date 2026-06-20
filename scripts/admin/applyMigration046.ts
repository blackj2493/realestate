/**
 * Apply Migration 046: region_active_aggregates reads flat dimension columns.
 * Run AFTER the backfill (scripts/admin/backfill-listings-dimensions.ts --apply) so the
 * fast path covers ~all rows; un-backfilled rows transparently fall back to full_payload.
 * Run: npx tsx scripts/admin/applyMigration046.ts   (needs DATABASE_URL / DIRECT_DB_URL)
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
  console.log('\n🔧 Migration 046: region_active_aggregates → flat columns');
  console.log('============================================\n');
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/046_region_active_aggregates_flat_columns.sql'),
      'utf-8'
    );
    console.log('📝 Executing migration SQL (CREATE OR REPLACE region_active_aggregates)...');
    await client.query(sql);
    console.log('✅ Migration applied successfully!\n');

    // Confirm statement_timeout survived the CREATE OR REPLACE.
    const cfg = await client.query(`
      SELECT proconfig FROM pg_proc
      WHERE proname = 'region_active_aggregates'
      AND pg_get_function_identity_arguments(oid) LIKE '%text'`);
    const conf = (cfg.rows[0]?.proconfig || []).join(', ') || '(none)';
    console.log(`📊 region_active_aggregates config: ${conf}`);
    console.log(/statement_timeout/.test(conf) ? '   ✅ statement_timeout retained\n' : '   ⚠️  statement_timeout missing\n');

    // Timed smoke test — the call that used to 500 / take ~17s should now be fast.
    const probe = async (label: string, args: string) => {
      const t0 = Date.now();
      const r = await client.query(`SELECT * FROM region_active_aggregates(${args})`);
      console.log(`   ${label}: ${JSON.stringify(r.rows[0])}  (${Date.now() - t0}ms)`);
    };
    console.log('🔎 Timed smoke test (Toronto):');
    await probe('any              ', `'Toronto'`);
    await probe('beds>=3          ', `'Toronto', NULL, 3`);
    await probe('beds>=3 finished ', `'Toronto', NULL, 3, 0, 0, 0, 'finished'`);
    await probe('unfinished       ', `'Toronto', NULL, 0, 0, 0, 0, 'unfinished'`);

    console.log('\n============================================');
    console.log('✅ Migration 046 Complete!');
    console.log('============================================\n');
  } catch (error: unknown) {
    console.error('\n❌ Migration failed!');
    console.error('   Error:', (error as { message?: string }).message);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

applyMigration().then(() => process.exit(0)).catch(() => process.exit(1));
