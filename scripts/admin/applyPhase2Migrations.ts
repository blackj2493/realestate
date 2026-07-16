// scripts/admin/applyPhase2Migrations.ts
/**
 * Apply Phase-2 migrations 061 (region_sold_dynamics) + 062 (region_rental_yield,
 * region_avm_reliability) via the Session pooler, then smoke-test each RPC on Brampton.
 * All three are additive CREATE OR REPLACE — no DROP, no schema change, no backfill.
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 *
 * Run: npx tsx scripts/admin/applyPhase2Migrations.ts
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

const MIGRATIONS = [
  '061_region_sold_dynamics.sql',
  '062_region_rental_and_avm.sql',
];

async function main() {
  console.log('\n🔧 Phase-2 migrations 061 + 062');
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('   ✅ Connected');
  try {
    for (const f of MIGRATIONS) {
      const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations', f), 'utf-8');
      await client.query(sql);
      console.log(`   ✅ applied ${f}`);
    }

    console.log('\n── smoke: Brampton ──');
    const sd = await client.query(`SELECT * FROM region_sold_dynamics('Brampton', NULL, 0, 0, 0, 0, 12, 'any')`);
    console.log('sold_dynamics:', JSON.stringify(sd.rows[0]));
    const ry = await client.query(`SELECT * FROM region_rental_yield('Brampton', NULL) ORDER BY beds`);
    console.log('rental_yield rows:', JSON.stringify(ry.rows));
    const ar = await client.query(`SELECT * FROM region_avm_reliability('Brampton', NULL)`);
    console.log('avm_reliability:', JSON.stringify(ar.rows[0]));

    // A Toronto district-roll-up sanity check (C01 etc. must aggregate under "Toronto").
    const tor = await client.query(`SELECT sold_count, median_dom, median_ppsf, ask_gap_median FROM region_sold_dynamics('Toronto', NULL, 0, 0, 0, 0, 12, 'any')`);
    console.log('Toronto sold_dynamics:', JSON.stringify(tor.rows[0]));

    console.log('\n✅ Phase-2 migrations complete.');
  } finally {
    await client.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
