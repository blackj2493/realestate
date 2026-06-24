/**
 * Phase-Zero · Move 1 — Vault min-n study + suppression rule
 * ----------------------------------------------------------
 * READ-ONLY analysis over `raw_vow_sold` (~217k immutable rows; never modified — CLAUDE.md §12).
 *
 * Purpose (from docs/strategy/phase-zero/01-vault-min-n-study.md):
 *   Pick the beachhead submarket(s) and define the suppression rule so the public "GTA Flip
 *   Scoreboard" and the private grading engine NEVER publish a thin, ungradeable cell. A submarket
 *   is only gradeable if it clears a configurable min-n of freehold 1–4-unit sold transactions per
 *   month. This is the controllable, evening-runnable Move 1 of Phase Zero — it converts the
 *   "is there enough data to grade THIS submarket" unknown into a known fact before any clock starts.
 *
 * It also prints a rough FLIP-VOLUME proxy (same property re-sold at a gain within ~2–18 months)
 * as an early, directional read on TAM in the target city. That proxy is NOT a precise count — it is
 * a sizing signal to be cross-checked against the warm-well enumeration (Move 2).
 *
 * Run:
 *   npx tsx scripts/admin/phaseZeroMinN.ts
 *   npx tsx scripts/admin/phaseZeroMinN.ts --city=Brampton --minN=12 --months=12 --grain=region
 *   npx tsx scripts/admin/phaseZeroMinN.ts --diagnose        # list distinct property_sub_type values
 *
 * Env (see CLAUDE.md §12 "DB connection strings"):
 *   DATABASE_URL  — Supabase **Session pooler** string (IPv4-reachable, port 5432). Preferred.
 *   DIRECT_DB_URL — direct host (IPv6-only; usually NOT reachable from local/CI here).
 *
 * Output: a console report + a JSON artifact written to ./phase-zero-minn-<city>-<stamp>.json
 */

import { Client } from 'pg';
import { writeFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', '.env'] });

// --- CLI args (--key=value) ------------------------------------------------
const argv = process.argv.slice(2);
const arg = (k: string, def: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : def;
};
const FLAG = (k: string): boolean => argv.includes(`--${k}`);

const TARGET_CITY = arg('city', 'Brampton');
const MIN_N = parseInt(arg('minN', '12'), 10); // monthly freehold-sold floor to call a cell gradeable
const MONTHS = parseInt(arg('months', '12'), 10); // trailing window for the min-n study
const FLIP_MONTHS = parseInt(arg('flipMonths', '24'), 10); // trailing window for the flip proxy
const GRAIN = arg('grain', 'region'); // 'region' (city_region) | 'fsa'
const DIAGNOSE = FLAG('diagnose');

// Freehold 1–4-unit residential, matched against VERBATIM TRREB spellings (raw column, btrim'd).
// Excludes condo ownership ('Condo Apartment', 'Condo Townhouse', 'Semi-Detached Condo') and
// unpriceable exotics (Vacant Land, Farm, Mobile, Parking, Multiplex, etc.). See
// src/lib/avm/normalizeType.ts for the canonical mapping this mirrors.
const FREEHOLD_SUBTYPES = [
  'Detached',
  'Semi-Detached',
  'Att/Row/Townhouse',
  'Attached/Row/Street Townhouse',
  'Townhouse',
  'Duplex',
  'Link',
];

const MIN_SALE_PRICE = 50_000; // excludes leases — matches AVM types.ts:MIN_SALE_PRICE

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2);
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!DATABASE_URL) {
    console.error('❌ No connection string found (set DATABASE_URL to the Supabase Session pooler URL, or DIRECT_DB_URL).');
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    params: { TARGET_CITY, MIN_N, MONTHS, FLIP_MONTHS, GRAIN, FREEHOLD_SUBTYPES, MIN_SALE_PRICE },
  };

  console.log(`\n=== Phase-Zero min-n study ===`);
  console.log(`city=${TARGET_CITY}  minN=${MIN_N}/mo  window=${MONTHS}mo  grain=${GRAIN}\n`);

  // --- 0. DIAGNOSTIC: distinct property_sub_type counts (verify the freehold filter) -----------
  if (DIAGNOSE) {
    const { rows } = await client.query(
      `SELECT btrim(property_sub_type) AS subtype, count(*)::int AS n
         FROM raw_vow_sold
        WHERE purchase_contract_date >= current_date - ($1 || ' months')::interval
        GROUP BY 1 ORDER BY 2 DESC`,
      [MONTHS],
    );
    console.log(`property_sub_type distribution (trailing ${MONTHS}mo, all cities):`);
    for (const r of rows) {
      const flagged = FREEHOLD_SUBTYPES.includes(r.subtype) ? '  <-- counted as freehold' : '';
      console.log(`  ${String(r.n).padStart(7)}  ${r.subtype}${flagged}`);
    }
    report.subtypeDistribution = rows;
    await client.end();
    const out = `phase-zero-minn-${TARGET_CITY}-diagnose.json`;
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${out}\n`);
    return;
  }

  // --- 1. CITY-LEVEL overview across the dataset (which 905 cities are even gradeable?) --------
  const cityRows = (
    await client.query(
      `SELECT city,
              count(*)::int AS total_freehold_sales,
              round(count(*)::numeric / GREATEST($2,1), 1) AS avg_per_month
         FROM raw_vow_sold
        WHERE btrim(property_sub_type) = ANY($1)
          AND close_price >= ${MIN_SALE_PRICE}
          AND purchase_contract_date >= current_date - ($2 || ' months')::interval
          AND city IS NOT NULL AND btrim(city) <> ''
        GROUP BY city
       HAVING count(*) >= $3
        ORDER BY total_freehold_sales DESC
        LIMIT 40`,
      [FREEHOLD_SUBTYPES, MONTHS, MIN_N],
    )
  ).rows;
  console.log(`Top cities by trailing-${MONTHS}mo freehold 1–4-unit sales (>= ${MIN_N} total):`);
  for (const r of cityRows) {
    const mark = r.city?.toLowerCase() === TARGET_CITY.toLowerCase() ? '  <== TARGET' : '';
    console.log(`  ${String(r.total_freehold_sales).padStart(6)}  (${String(r.avg_per_month).padStart(6)}/mo)  ${r.city}${mark}`);
  }
  report.cityOverview = cityRows;

  // --- 2. SUBMARKET-MONTH min-n within the target city -----------------------------------------
  // grain 'region' => city_region; grain 'fsa' => LEFT(postal_code,3)
  const grainExpr =
    GRAIN === 'fsa' ? `upper(left(postal_code, 3))` : `coalesce(nullif(btrim(city_region), ''), '(blank)')`;

  const cellRows = (
    await client.query(
      `WITH base AS (
         SELECT ${grainExpr} AS submarket,
                to_char(date_trunc('month', purchase_contract_date), 'YYYY-MM') AS month
           FROM raw_vow_sold
          WHERE btrim(property_sub_type) = ANY($1)
            AND close_price >= ${MIN_SALE_PRICE}
            AND lower(city) = lower($2)
            AND purchase_contract_date >= current_date - ($3 || ' months')::interval
       )
       SELECT submarket, month, count(*)::int AS n
         FROM base
        GROUP BY submarket, month
        ORDER BY submarket, month`,
      [FREEHOLD_SUBTYPES, TARGET_CITY, MONTHS],
    )
  ).rows as Array<{ submarket: string; month: string; n: number }>;

  // Roll up per submarket: months observed, months clearing min-n, median monthly n, total.
  const bySub = new Map<string, number[]>();
  for (const r of cellRows) {
    if (!bySub.has(r.submarket)) bySub.set(r.submarket, []);
    bySub.get(r.submarket)!.push(r.n);
  }
  const submarketSummary = [...bySub.entries()]
    .map(([submarket, counts]) => {
      const monthsObserved = counts.length;
      const monthsClearing = counts.filter((c) => c >= MIN_N).length;
      return {
        submarket,
        monthsObserved,
        monthsClearing,
        clearingPct: monthsObserved ? Math.round((100 * monthsClearing) / monthsObserved) : 0,
        medianMonthly: median(counts),
        total: counts.reduce((a, b) => a + b, 0),
        // GRADEABLE = clears min-n in a strong majority of observed months (>=10 of last 12 is ideal).
        gradeable: monthsObserved >= Math.min(MONTHS, 10) && monthsClearing >= Math.ceil(0.8 * monthsObserved),
      };
    })
    .sort((a, b) => b.total - a.total);

  console.log(`\nSubmarkets in ${TARGET_CITY} (grain=${GRAIN}) — gradeable = clears ${MIN_N}/mo in >=80% of observed months:`);
  console.log(`  ${'GRADE'.padEnd(6)} ${'median/mo'.padStart(10)} ${'clearing'.padStart(9)} ${'total'.padStart(7)}  submarket`);
  for (const s of submarketSummary) {
    const grade = s.gradeable ? '  ✅  ' : '  --  ';
    console.log(
      `  ${grade} ${String(s.medianMonthly).padStart(10)} ${`${s.monthsClearing}/${s.monthsObserved}`.padStart(9)} ${String(s.total).padStart(7)}  ${s.submarket}`,
    );
  }
  const gradeableCount = submarketSummary.filter((s) => s.gradeable).length;
  console.log(`\n  => ${gradeableCount} gradeable submarket(s) in ${TARGET_CITY}.`);
  report.targetCity = TARGET_CITY;
  report.submarketSummary = submarketSummary;
  report.suppressionRule = {
    description: `Publish/grade a (submarket × month) cell only when freehold 1–4-unit sales >= ${MIN_N}; otherwise auto-roll up to the parent city or suppress.`,
    minN: MIN_N,
    grain: GRAIN,
  };

  // --- 3. FLIP-VOLUME PROXY in the target city (directional TAM read; NOT a precise count) ------
  // Same property_hash sold twice, 2nd sale 2–18 months after the 1st AND at a higher price.
  const flip = (
    await client.query(
      `WITH sales AS (
         SELECT property_hash, purchase_contract_date::date AS pcd, close_price
           FROM raw_vow_sold
          WHERE btrim(property_sub_type) = ANY($1)
            AND close_price >= ${MIN_SALE_PRICE}
            AND lower(city) = lower($2)
            AND property_hash IS NOT NULL AND btrim(property_hash) <> ''
            AND purchase_contract_date >= current_date - ($3 || ' months')::interval
       ), pairs AS (
         SELECT a.property_hash,
                (b.pcd - a.pcd) AS hold_days,
                a.close_price AS buy_price,
                b.close_price AS sell_price
           FROM sales a
           JOIN sales b
             ON a.property_hash = b.property_hash
            AND b.pcd > a.pcd
            AND (b.pcd - a.pcd) BETWEEN 60 AND 550
            AND b.close_price > a.close_price
       )
       SELECT count(DISTINCT property_hash)::int AS flip_properties,
              count(*)::int AS flip_pairs,
              round(avg(hold_days))::int AS avg_hold_days,
              round(avg(sell_price - buy_price))::int AS avg_gross_spread
         FROM pairs`,
      [FREEHOLD_SUBTYPES, TARGET_CITY, FLIP_MONTHS],
    )
  ).rows[0];
  console.log(`\nFlip-volume PROXY in ${TARGET_CITY} (trailing ${FLIP_MONTHS}mo; same property re-sold at a gain in 2–18mo):`);
  console.log(`  ~${flip.flip_properties} flipped properties  (${flip.flip_pairs} buy→sell pairs)`);
  console.log(`  avg hold ~${flip.avg_hold_days} days  ·  avg gross spread ~$${Number(flip.avg_gross_spread).toLocaleString()}`);
  console.log(`  (PROXY ONLY — re-sales include non-flips; cross-check against the warm-well count in Move 2.)`);
  report.flipProxy = flip;

  await client.end();

  const stamp = new Date().toISOString().slice(0, 10);
  const out = `phase-zero-minn-${TARGET_CITY}-${stamp}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nWrote full report to ${out}\n`);

  // --- Decision hint ---------------------------------------------------------------------------
  console.log(`Decision (per docs/strategy/phase-zero/01-vault-min-n-study.md):`);
  console.log(`  • If 0 gradeable submarkets in ${TARGET_CITY}: widen grain (--grain=region or city-level), or pick a different primary city.`);
  console.log(`  • If 1+ gradeable submarkets: those are your launch cells. Lock the suppression rule (min-n=${MIN_N}, auto-rollup to city).`);
  console.log(`  • Carry the flip-proxy number into the warm-well enumeration — they should be the same order of magnitude.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
