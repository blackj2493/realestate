/**
 * READ-ONLY. How many listings still DISPLAY a cap rate?
 *
 * cap_rate_est is stored raw, but the UI shows it through CAP_RATE_BAND [1,15]
 * (capRateOrNull). Anything outside reads as "no estimate". Retiring the 1.6x
 * multiplier lowered rent by a factor of 1.6 on the scored candidates, which pushes
 * some listings below the band's floor — an honest number that the reader nonetheless
 * stops seeing. This measures that, split by whether a suite was observed.
 *
 * Usage: npx tsx scripts/admin/_probeCapBandCoverage.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import { CAP_RATE_BAND } from '@/lib/metrics/sanityBand';

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const { rows } = await client.query(
    `SELECT
       count(*)                                                        AS sale_listings,
       count(*) FILTER (WHERE rent_match_tier IS NOT NULL)             AS has_comp,
       count(*) FILTER (WHERE cap_rate_est >= $1 AND cap_rate_est <= $2) AS in_band,
       count(*) FILTER (WHERE cap_rate_est IS NOT NULL AND cap_rate_est < $1) AS below_floor,
       count(*) FILTER (WHERE cap_rate_est > $2)                       AS above_ceiling,
       count(*) FILTER (WHERE suite_rent_est IS NOT NULL)              AS with_suite,
       count(*) FILTER (WHERE suite_rent_est IS NOT NULL
                          AND cap_rate_est >= $1 AND cap_rate_est <= $2) AS suite_in_band
     FROM listings
    WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ 'sale'`,
    [CAP_RATE_BAND.min, CAP_RATE_BAND.max]
  );
  const r = rows[0];
  const pct = (n: string, d: string) => `${((Number(n) / Number(d)) * 100).toFixed(1)}%`;

  console.log(`Band in force: [${CAP_RATE_BAND.min}, ${CAP_RATE_BAND.max}]`);
  console.log('');
  console.log(`Active for-sale listings        ${Number(r.sale_listings).toLocaleString().padStart(9)}`);
  console.log(`  have a rent comp              ${Number(r.has_comp).toLocaleString().padStart(9)}  ${pct(r.has_comp, r.sale_listings)}`);
  console.log(`  DISPLAY a cap rate (in band)  ${Number(r.in_band).toLocaleString().padStart(9)}  ${pct(r.in_band, r.has_comp)} of those with a comp`);
  console.log(`  below the floor (hidden)      ${Number(r.below_floor).toLocaleString().padStart(9)}`);
  console.log(`  above the ceiling (hidden)    ${Number(r.above_ceiling).toLocaleString().padStart(9)}`);
  console.log('');
  console.log(`Observed suites                 ${Number(r.with_suite).toLocaleString().padStart(9)}`);
  console.log(`  of which display a cap rate   ${Number(r.suite_in_band).toLocaleString().padStart(9)}  ${pct(r.suite_in_band, r.with_suite)}`);

  // Where do the sub-floor ones sit? A cluster just under 1% is the band clipping
  // honest numbers; a mass at deeply negative is the cost side genuinely winning.
  const { rows: shape } = await client.query(
    `SELECT width_bucket(cap_rate_est, -6, 1, 7) AS b, count(*)
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ 'sale'
        AND cap_rate_est IS NOT NULL AND cap_rate_est < $1
      GROUP BY 1 ORDER BY 1`,
    [CAP_RATE_BAND.min]
  );
  console.log('\nWhere the hidden ones sit (cap rate, %):');
  const edges = ['< -6', '-6..-5', '-5..-4', '-4..-3', '-3..-2', '-2..-1', '-1..0', '0..1'];
  for (const s of shape) {
    console.log(`  ${(edges[Number(s.b)] ?? '?').padEnd(8)} ${Number(s.count).toLocaleString().padStart(8)}`);
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
