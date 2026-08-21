/**
 * READ-ONLY probe #6. EXISTING_MULTI_UNIT fires on four different triggers, and they
 * are not equally trustworthy — nor equally safe to add suite income to.
 *
 *   1. sub-type Duplex/Triplex/Multiplex/Fourplex  -> the RENT COMP IS ALREADY THE PLEX.
 *      Adding a suite line here double counts.
 *   2. KitchensBelowGrade > 0                      -> structural, observed.
 *   3. Basement contains 'Apartment'               -> structural, observed.
 *   4. PublicRemarks regex                         -> soft. "in-law suite" is family,
 *      not income; "currently rented" may mean the whole house.
 *
 * Usage: npx tsx scripts/admin/_probeExistingSuiteTriggers.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const PLEX = new Set(['Duplex', 'Triplex', 'Multiplex', 'Fourplex']);
const REMARKS_RE = /(existing suite|in-law suite|currently rented|basement apt|legal suite)/i;

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const { rows } = await client.query(
    `SELECT full_payload->>'PropertySubType'    AS sub_type,
            full_payload->>'KitchensBelowGrade' AS kbg,
            coalesce(full_payload->'Basement','[]'::jsonb)::text AS basement,
            left(coalesce(full_payload->>'PublicRemarks',''), 900) AS remarks,
            coalesce(full_payload->>'PropertyType','')  AS ptype,
            full_payload->>'CondoCorpNumber'    AS corp
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ 'sale'`
  );

  let plex = 0;
  let kitchen = 0;
  let basementApt = 0;
  let remarksOnly = 0;
  let countable = 0; // house + observed second kitchen or basement apartment
  const remarkSample = new Map<string, number>();

  for (const r of rows) {
    // Strata killswitch, same order as multiUnitCalculator.
    if ((r.ptype ?? '').includes('Condo') || r.corp || r.sub_type === 'Condo Townhouse') continue;

    const isPlex = PLEX.has(r.sub_type ?? '');
    const hasKitchen = /^[1-9]/.test(r.kbg ?? '');
    const hasApt = (r.basement as string).toLowerCase().includes('apartment');
    const hitsRemarks = REMARKS_RE.test(r.remarks ?? '');

    if (isPlex) plex += 1;
    else if (hasKitchen) kitchen += 1;
    else if (hasApt) basementApt += 1;
    else if (hitsRemarks) {
      remarksOnly += 1;
      const m = (r.remarks as string).match(REMARKS_RE);
      if (m) remarkSample.set(m[0].toLowerCase(), (remarkSample.get(m[0].toLowerCase()) ?? 0) + 1);
    }

    if (!isPlex && (hasKitchen || hasApt)) countable += 1;
  }

  console.log(`EXISTING_MULTI_UNIT, by first trigger that fires:`);
  console.log(`  plex sub-type (comp already covers it)  ${plex.toLocaleString().padStart(7)}`);
  console.log(`  KitchensBelowGrade > 0                  ${kitchen.toLocaleString().padStart(7)}`);
  console.log(`  Basement 'Apartment', no kitchen field   ${basementApt.toLocaleString().padStart(7)}`);
  console.log(`  PublicRemarks regex only                ${remarksOnly.toLocaleString().padStart(7)}   <- soft`);
  console.log('');
  console.log(`COUNTABLE suite income (house + observed suite): ${countable.toLocaleString()}`);
  console.log('');
  console.log('What the remarks-only phrase actually was:');
  for (const [k, v] of [...remarkSample].sort((a, b) => b[1] - a[1])) {
    console.log(`  "${k}"`.padEnd(24) + v.toLocaleString().padStart(7));
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
