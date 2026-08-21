/**
 * READ-ONLY probe #2. Can we replace the flat $1,500 SUITE_INCOME_DEFAULT with a real
 * in-home-unit rent from the same lease book the whole-home ladder is built from?
 *
 * Measures three things:
 *   1. The spread of in-home unit rents — is one constant defensible anywhere?
 *   2. Cohort counts at city/neighbourhood level, at MIN_COHORT_SAMPLES = 3.
 *   3. Coverage: of the for-sale listings that would use it (KitchensBelowGrade > 0),
 *      how many land on a cohort?
 *
 * Usage: npx tsx scripts/admin/_probeBasementRentCohorts.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const PARTIAL_UNIT_RE = new RegExp(
  [
    /\b(?:bsmn?t|basement|walk\s*-?\s*out)\b/.source,
    /#\s*(?:bsmn?t|basement)/.source,
    /\([^)]*\b(?:lower|upper|main|bsmn?t|basement)\b[^)]*\)/.source,
    /-\s*(?:lower|upper|main)\b/.source,
    /\b(?:lower|upper|main)\s+(?:level|floor|unit|apt|apartment|suite)\b/.source,
    /\b(?:lower|upper|main)\s*(?:$|,)/.source,
  ].join('|'),
  'i'
);
const IN_HOME_SUBTYPES = new Set(['lower level', 'upper level']);
const isPartial = (address?: string | null, subType?: string | null) =>
  (!!subType && IN_HOME_SUBTYPES.has(subType.trim().toLowerCase())) ||
  (!!address && PARTIAL_UNIT_RE.test(address));

const MIN_N = 3;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pctile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const { rows: leases } = await client.query(
    `SELECT list_price, city, city_region,
            btrim(coalesce(property_sub_type, '')) AS sub_type,
            full_payload->>'UnparsedAddress'       AS address,
            full_payload->>'BedroomsTotal'         AS beds
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType', '')) ~ '(leas|rent)'
        AND list_price BETWEEN 500 AND 25000`
  );

  const units = leases.filter((r) => isPartial(r.address, r.sub_type));
  const rents = units.map((r) => Number(r.list_price));
  console.log(`In-home unit leases: ${units.length.toLocaleString()} of ${leases.length.toLocaleString()}`);
  console.log(
    `  rent p10 $${pctile(rents, 10).toLocaleString()}  p25 $${pctile(rents, 25).toLocaleString()}  ` +
      `MEDIAN $${median(rents).toLocaleString()}  p75 $${pctile(rents, 75).toLocaleString()}  p90 $${pctile(rents, 90).toLocaleString()}`
  );

  // How wrong is one flat number? Score $1,500 against every unit's own city median.
  const byCity = new Map<string, number[]>();
  const byNbhd = new Map<string, number[]>();
  for (const r of units) {
    const price = Number(r.list_price);
    const beds = /^[0-9]+$/.test(r.beds ?? '') ? Math.min(3, parseInt(r.beds, 10)) : null;
    if (r.city) {
      const k = `${r.city}|${beds ?? '?'}`;
      (byCity.get(k) ?? byCity.set(k, []).get(k)!).push(price);
    }
    if (r.city_region) {
      const k = `${r.city_region}|${beds ?? '?'}`;
      (byNbhd.get(k) ?? byNbhd.set(k, []).get(k)!).push(price);
    }
  }
  const cityCohorts = new Map(
    [...byCity].filter(([, v]) => v.length >= MIN_N).map(([k, v]) => [k, median(v)])
  );
  const nbhdCohorts = new Map(
    [...byNbhd].filter(([, v]) => v.length >= MIN_N).map(([k, v]) => [k, median(v)])
  );
  const cityMedians = [...cityCohorts.values()];
  console.log('');
  console.log(`Cohorts at n>=${MIN_N}:  city+beds ${cityCohorts.size.toLocaleString()}   nbhd+beds ${nbhdCohorts.size.toLocaleString()}`);
  console.log(
    `  city-cohort medians range $${Math.min(...cityMedians).toLocaleString()} .. $${Math.max(...cityMedians).toLocaleString()}` +
      `  (p10 $${pctile(cityMedians, 10).toLocaleString()}, p90 $${pctile(cityMedians, 90).toLocaleString()})`
  );
  const errVsFlat = cityMedians.map((m) => Math.abs(1500 - m) / m);
  console.log(
    `  a flat $1,500 vs those medians: median error ${(median(errVsFlat) * 100).toFixed(1)}%,  ` +
      `${errVsFlat.filter((e) => e > 0.25).length} of ${errVsFlat.length} cohorts off by >25%`
  );

  // Coverage over the listings that would actually use this.
  const { rows: cand } = await client.query(
    `SELECT city, city_region,
            full_payload->>'KitchensBelowGrade' AS kbg
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType', '')) ~ 'sale'
        AND coalesce(full_payload->>'KitchensBelowGrade', '0') ~ '^[1-9]'`
  );
  let hitNbhd = 0;
  let hitCity = 0;
  for (const r of cand) {
    // A suite is underwritten as a 1-bed unit unless we learn otherwise.
    if (r.city_region && nbhdCohorts.has(`${r.city_region}|1`)) hitNbhd += 1;
    else if (r.city && cityCohorts.has(`${r.city}|1`)) hitCity += 1;
  }
  console.log('');
  console.log(`For-sale listings with a below-grade kitchen: ${cand.length.toLocaleString()}`);
  console.log(`  land on a NEIGHBOURHOOD 1-bed suite cohort: ${hitNbhd.toLocaleString()}`);
  console.log(`  fall back to a CITY 1-bed suite cohort    : ${hitCity.toLocaleString()}`);
  console.log(
    `  covered ${(((hitNbhd + hitCity) / Math.max(1, cand.length)) * 100).toFixed(1)}%   ` +
      `uncovered ${(cand.length - hitNbhd - hitCity).toLocaleString()}`
  );

  console.log('');
  console.log('Sample city 1-bed suite medians (vs the flat $1,500):');
  const sample = [...cityCohorts]
    .filter(([k]) => k.endsWith('|1'))
    .sort((a, b) => b[1] - a[1]);
  for (const [k, m] of [...sample.slice(0, 6), ...sample.slice(-6)]) {
    console.log(`  ${k.replace('|1', '').padEnd(28)} $${String(m.toLocaleString()).padStart(6)}   ${m > 1500 ? '+' : ''}${(((m - 1500) / 1500) * 100).toFixed(0)}% vs flat`);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
