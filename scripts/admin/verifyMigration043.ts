/**
 * Verify Migration 043 (READ-ONLY — no DDL, no writes).
 *
 * Confirms both RPCs expose the new `p_basement` overload and that a
 * finished/unfinished constraint actually subsets the unconstrained totals.
 *
 * Run: npx tsx scripts/admin/verifyMigration043.ts [region]   (default region: Toronto)
 * Needs DATABASE_URL or DIRECT_DB_URL (same as applyMigration043).
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
const REGION = process.argv[2] || 'Toronto';

if (!DATABASE_URL) {
  console.error('❌ No connection string (set DATABASE_URL or DIRECT_DB_URL)');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });
  await client.connect();
  console.log('\n✅ Connected — verifying migration 043 (read-only)\n');

  try {
    // 1. Signatures — each function must have an overload whose last arg is `text` (p_basement).
    for (const fn of ['region_active_aggregates', 'region_price_trend']) {
      const r = await client.query(
        `SELECT pg_get_function_identity_arguments(oid) AS args
         FROM pg_proc WHERE proname = $1 ORDER BY args;`,
        [fn]
      );
      const hasBasement = r.rows.some((row: { args: string }) => /text$/.test(row.args.trim()));
      console.log(`${hasBasement ? '✅' : '❌'} ${fn} — p_basement overload ${hasBasement ? 'present' : 'MISSING'}`);
      for (const row of r.rows) console.log(`     • (${row.args})`);
    }

    // 2. Active stats smoke — finished + unfinished should each be ≤ any.
    const a = await client.query(
      `SELECT
         (region_active_aggregates($1)).active_count                              AS any_a,
         (region_active_aggregates($1, NULL, 0,0,0,0, 'finished')).active_count   AS fin_a,
         (region_active_aggregates($1, NULL, 0,0,0,0, 'unfinished')).active_count AS unf_a`,
      [REGION]
    );
    console.log(`\n🔎 ${REGION} active_count  any/fin/unf:`, a.rows[0]);

    // 3. Sold-trend smoke (sales90).
    const t = await client.query(
      `SELECT
         region_price_trend($1)                                  -> 'summary' ->> 'sales90' AS any_s,
         region_price_trend($1, NULL, 0,0,0,0, 24, 'finished')   -> 'summary' ->> 'sales90' AS fin_s,
         region_price_trend($1, NULL, 0,0,0,0, 24, 'unfinished') -> 'summary' ->> 'sales90' AS unf_s`,
      [REGION]
    );
    console.log(`🔎 ${REGION} sold sales90  any/fin/unf:`, t.rows[0]);

    // 4. Sanity assertions (subset relationship).
    const { any_a, fin_a, unf_a } = a.rows[0];
    const ok = Number(fin_a) <= Number(any_a) && Number(unf_a) <= Number(any_a);
    console.log(`\n${ok ? '✅' : '❌'} subset check: finished(${fin_a}) & unfinished(${unf_a}) ≤ any(${any_a})`);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed.\n');
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
