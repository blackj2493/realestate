/**
 * Region-metrics RPCs — prove the lease filter changed nothing, then keep it honest.
 *
 * These five functions publish the medians behind /analytics. Swapping their
 * `close_price >= 50000` lease-proxy for an explicit transaction_type filter is
 * meant to be PURELY DEFENSIVE: no lease has ever closed above $50k, so today the
 * two filters select exactly the same rows. This asserts that rather than
 * assuming it — a published median silently shifting would be the worst possible
 * outcome of a robustness fix.
 *
 *   --snapshot <file>   capture every function's output for a sample of regions
 *   --compare  <file>   re-run and diff against that capture (exit 1 on any drift)
 *   (no flag)           structural checks only
 *
 * Structural checks always run:
 *   * no live function still separates sales from leases by price alone
 *   * each function returns rows for a real region
 *
 * Usage:
 *   npx tsx scripts/admin/verifyRegionRpcs.ts --snapshot before.json
 *   npx tsx scripts/admin/applyMigrationFiles.ts 106_region_rpcs_transaction_type.sql
 *   npx tsx scripts/admin/verifyRegionRpcs.ts --compare before.json
 */
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const argOf = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const SNAPSHOT = argOf('--snapshot');
const COMPARE = argOf('--compare');

const n = (x: number) => Number(x).toLocaleString('en-US');
let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** The five functions, with a call shape that exercises each one. */
const CALLS: { fn: string; sql: (region: string) => string }[] = [
  { fn: 'region_sold_dynamics',    sql: (r) => `SELECT * FROM region_sold_dynamics('${r}', NULL, 0, 0, 0, 0, 12, NULL)` },
  { fn: 'region_price_trend',      sql: (r) => `SELECT * FROM region_price_trend('${r}', NULL, 0, 0, 0, 0, 12, NULL)` },
  { fn: 'region_listing_outcomes', sql: (r) => `SELECT * FROM region_listing_outcomes('${r}', NULL, 12)` },
  { fn: 'region_rental_yield',     sql: (r) => `SELECT * FROM region_rental_yield('${r}', NULL)` },
  { fn: 'region_seasonality',      sql: (r) => `SELECT * FROM region_seasonality('${r}', NULL)` },
];

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '900s'");
  console.log('\n📊  region-metrics RPCs — lease separation check');
  console.log('='.repeat(66));

  try {
    // Regions are derived from the data — a hardcoded name that matches nothing
    // makes every check pass by returning zero rows.
    const { rows: regions } = await c.query(`
      SELECT city AS region, count(*)::int AS n
      FROM raw_vow_sold
      WHERE transaction_type = 'For Sale'
        AND purchase_contract_date >= current_date - 365
        AND city IS NOT NULL AND city <> ''
      GROUP BY 1 ORDER BY 2 DESC LIMIT 6`);
    const names: string[] = regions.map((r) => r.region);
    console.log(`\nProbe regions (busiest, derived): ${names.join(' · ')}`);

    // ── structural ────────────────────────────────────────────────────────
    const { rows: leftovers } = await c.query(`
      WITH defs AS MATERIALIZED (
        SELECT p.proname, pg_get_functiondef(p.oid) AS def
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
      )
      SELECT proname FROM defs
      WHERE def LIKE '%close_price >= 50000%'
        -- Must be the explicit sale filter, not merely a mention of the column:
        -- region_listing_outcomes already referenced transaction_type in its
        -- de-listed branch while its SOLD branch still used the price proxy, so a
        -- loose LIKE would have passed it.
        AND def NOT LIKE '%transaction_type = ''For Sale''%'
      ORDER BY 1`);
    console.log('\nStructure:');
    check('no function separates sales from leases by price alone',
      leftovers.length === 0,
      leftovers.length ? leftovers.map((r) => r.proname).join(', ') : 'all filtered by transaction_type');

    // ── the assumption the old proxy rested on ────────────────────────────
    const { rows: [risk] } = await c.query(`
      SELECT count(*)::int AS n FROM raw_vow_sold
      WHERE transaction_type <> 'For Sale' AND close_price >= 50000`);
    console.log(`\n  ${n(risk.n)} non-sale rows currently close at or above $50,000.`);
    console.log('     That is why the old proxy "worked" — and exactly the assumption removed.');

    // ── outputs ───────────────────────────────────────────────────────────
    console.log('\nOutputs:');
    const captured: Record<string, unknown> = {};
    for (const { fn, sql } of CALLS) {
      let total = 0;
      for (const region of names) {
        const { rows } = await c.query(sql(region));
        captured[`${fn}|${region}`] = rows;
        total += rows.length;
      }
      check(`${fn} returns rows`, total > 0, `${n(total)} rows across ${names.length} regions`);
    }

    if (SNAPSHOT) {
      writeFileSync(SNAPSHOT, JSON.stringify(captured, null, 0), 'utf8');
      console.log(`\n📸 snapshot written to ${SNAPSHOT} (${Object.keys(captured).length} result sets)`);
    }

    if (COMPARE) {
      const before = JSON.parse(readFileSync(COMPARE, 'utf8')) as Record<string, unknown>;
      const keys = new Set([...Object.keys(before), ...Object.keys(captured)]);
      let drifted = 0;
      for (const k of keys) {
        const a = JSON.stringify(before[k] ?? null);
        const b = JSON.stringify(captured[k] ?? null);
        if (a !== b) {
          drifted++;
          console.log(`     ✗ ${k}`);
          console.log(`        before: ${a.slice(0, 160)}`);
          console.log(`        after : ${b.slice(0, 160)}`);
        }
      }
      console.log('');
      check('every published metric is byte-identical to before the change',
        drifted === 0, `${n(keys.size - drifted)}/${n(keys.size)} result sets unchanged`);
    }

    console.log('\n' + '='.repeat(66));
    if (failures) { console.error(`❌ ${failures} check(s) failed.`); process.exit(1); }
    console.log('✅ All checks passed.');
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error('❌ Failed:', e?.message || e); process.exit(1); });
