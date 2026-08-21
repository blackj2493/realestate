/**
 * READ-ONLY. Did migration 125 actually land the way the canary predicted?
 *
 * Verifies the applied state rather than trusting the job's exit message — the same
 * discipline the AVM trainer needed (a promotion gate can pass while every beta is
 * zero). Checks the ledger, the rebuilt ladder, the suite column, and the shape of the
 * cap-rate distribution against what suite-rent-impact-canary.ts forecast.
 *
 * Usage: npx tsx scripts/admin/_probe125Applied.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const q = async (label: string, sql: string) => {
    const { rows } = await client.query(sql);
    console.log(`\n── ${label} ─────────────────────────────`);
    for (const r of rows) console.log('  ' + Object.entries(r).map(([k, v]) => `${k}=${v}`).join('  '));
    return rows;
  };

  await q('migration ledger', `
    SELECT filename, applied_at FROM schema_migrations
     WHERE filename LIKE '12%' ORDER BY filename DESC LIMIT 4`);

  await q('rental_market_index by rung', `
    SELECT match_tier, count(*) AS cohorts, round(avg(sample_count)::numeric, 1) AS avg_n
      FROM rental_market_index GROUP BY match_tier ORDER BY cohorts DESC`);

  await q('suite cohorts — rent spread', `
    SELECT min(avg_rent) AS lo,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_rent)::int AS median,
           max(avg_rent) AS hi,
           count(*) AS cohorts
      FROM rental_market_index WHERE match_tier LIKE 'suite_%'`);

  await q('listings carrying a suite rent', `
    SELECT count(*) FILTER (WHERE suite_rent_est IS NOT NULL) AS with_suite,
           count(*) FILTER (WHERE suite_rent_est IS NOT NULL
                              AND coalesce(full_payload->>'KitchensBelowGrade','0') !~ '^[1-9]'
                              AND coalesce(full_payload->'Basement','[]'::jsonb)::text NOT ILIKE '%apartment%')
             AS suite_without_observation,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY suite_rent_est)::int AS median_suite_rent
      FROM listings
     WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ 'sale'`);

  await q('cap_rate_est distribution, active for-sale', `
    SELECT count(*) FILTER (WHERE cap_rate_est IS NOT NULL) AS with_cap,
           count(*) FILTER (WHERE cap_rate_est < 0) AS negative,
           round(percentile_cont(0.10) WITHIN GROUP (ORDER BY cap_rate_est)::numeric, 2) AS p10,
           round(percentile_cont(0.50) WITHIN GROUP (ORDER BY cap_rate_est)::numeric, 2) AS median,
           round(percentile_cont(0.90) WITHIN GROUP (ORDER BY cap_rate_est)::numeric, 2) AS p90
      FROM listings
     WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ 'sale'
       AND cap_rate_est IS NOT NULL`);

  await q('rent_match_tier spread', `
    SELECT coalesce(rent_match_tier,'(none)') AS tier, count(*)
      FROM listings
     WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ 'sale'
     GROUP BY 1 ORDER BY 2 DESC`);

  console.log('\nExpected from the canary: book median ~2.12%, no suite rent without an observation.');
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
