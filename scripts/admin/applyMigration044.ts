/**
 * Apply Migration 044: pin statement_timeout='60s' on the two region-aggregate RPCs
 * so a cold filtered "Toronto" query (~17s full_payload detoast) completes + caches
 * instead of 500ing on the role's default statement_timeout.
 *
 * Instant DDL (GUC attach only) — no body change, no table touch.
 * Run: npx tsx scripts/admin/applyMigration044.ts
 * Needs DATABASE_URL or DIRECT_DB_URL.
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
  console.log('\n🔧 Migration 044: region RPC statement_timeout');
  console.log('============================================\n');
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/044_region_rpc_statement_timeout.sql'),
      'utf-8'
    );
    console.log('📝 Executing migration SQL (ALTER FUNCTION ... SET statement_timeout)...');
    await client.query(sql);
    console.log('✅ Migration applied successfully!\n');

    // Confirm the GUC is attached to each function (proconfig).
    const r = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(oid) AS args, proconfig
      FROM pg_proc
      WHERE proname IN ('region_active_aggregates', 'region_price_trend')
      ORDER BY proname, args`);
    for (const row of r.rows) {
      const cfg = (row.proconfig || []).join(', ') || '(none)';
      const ok = /statement_timeout/.test(cfg);
      console.log(`${ok ? '✅' : '⚠️ '} ${row.proname}(${row.args}) → ${cfg}`);
    }

    // Smoke: the previously-failing cold call (Toronto + beds floor) should now return.
    console.log('\n🔎 Toronto beds>=3 + finished basement (the call that used to 500):');
    const t0 = Date.now();
    const smoke = await client.query(
      `SELECT * FROM region_active_aggregates('Toronto', NULL, 3, 0, 0, 0, 'finished')`
    );
    console.log(`   ${JSON.stringify(smoke.rows[0])}  (${Date.now() - t0}ms)`);

    console.log('\n============================================');
    console.log('✅ Migration 044 Complete!');
    console.log('============================================\n');
  } catch (error: unknown) {
    const e = error as { message?: string; code?: string };
    console.error('\n❌ Migration failed!');
    console.error('   Error:', e.message);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

applyMigration().then(() => process.exit(0)).catch(() => process.exit(1));
