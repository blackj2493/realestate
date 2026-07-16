// scripts/admin/applyMigration060.ts
/**
 * Apply Migration 060 (naive-age floor in region_dom_distribution + region_active_aggregates)
 * via the Session pooler. CREATE OR REPLACE on both (signatures unchanged, no DROP).
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 *
 * Run: npx tsx scripts/admin/applyMigration060.ts
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

async function main() {
  console.log('\n🔧 Migration 060: true_dom naive-age floor (both region RPCs)');
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('   ✅ Connected');
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/060_truedom_naive_floor.sql'), 'utf-8');
    await client.query(sql);

    // Smoke: Brampton before/after — median should rise off 32, p25 off 0, % stale up from 30%.
    const d = await client.query(`SELECT median_true_dom, median_naive_dom, p25_true_dom, p75_true_dom, active_count FROM region_dom_distribution('Brampton', NULL, 0, 0, 0, 0, 'any')`);
    const s = await client.query(`SELECT active_count, stale_count FROM region_active_aggregates('Brampton', NULL, 0, 0, 0, 0, 'any')`);
    const sc = s.rows[0];
    console.log('   DoM:', JSON.stringify(d.rows[0]));
    console.log('   scorecard % stale:', sc.active_count ? ((sc.stale_count / sc.active_count) * 100).toFixed(1) + '%' : '—');
    console.log('✅ Migration 060 complete.');
  } finally {
    await client.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
