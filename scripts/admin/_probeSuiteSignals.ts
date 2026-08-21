/**
 * READ-ONLY probe #3. How sharp is the "this basement is a rentable unit" signal?
 *
 * KitchensBelowGrade > 0 says a second kitchen exists. It does NOT say the space can
 * be leased separately. The feed also ships a Basement array carrying 'Separate
 * Entrance' / 'Apartment' / 'Walk-Out', which is the difference between a suite and a
 * second kitchen for the in-laws.
 *
 * Usage: npx tsx scripts/admin/_probeSuiteSignals.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const { rows } = await client.query(
    `SELECT coalesce(full_payload->>'KitchensBelowGrade', '0')      AS kbg,
            coalesce(full_payload->'Basement', '[]'::jsonb)::text   AS basement,
            coalesce(full_payload->>'PropertySubType', '')          AS sub_type
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType', '')) ~ 'sale'`
  );

  const has = (s: string, needle: string) => s.toLowerCase().includes(needle);
  let kbg = 0;
  let sepEntrance = 0;
  let apartment = 0;
  let walkout = 0;
  let kbgAndSep = 0;
  let kbgOnly = 0;
  let sepNoKbg = 0;

  for (const r of rows) {
    const k = /^[1-9]/.test(r.kbg);
    const b = r.basement as string;
    const sep = has(b, 'separate entrance');
    const apt = has(b, 'apartment');
    const wo = has(b, 'walk-out') || has(b, 'walk out') || has(b, 'walkout');
    const rentable = sep || apt || wo;
    if (k) kbg += 1;
    if (sep) sepEntrance += 1;
    if (apt) apartment += 1;
    if (wo) walkout += 1;
    if (k && rentable) kbgAndSep += 1;
    else if (k) kbgOnly += 1;
    else if (rentable) sepNoKbg += 1;
  }

  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(1)}%`;
  console.log(`Active for-sale listings: ${rows.length.toLocaleString()}`);
  console.log('');
  console.log(`KitchensBelowGrade > 0            ${kbg.toLocaleString().padStart(7)}  ${pct(kbg)}`);
  console.log(`Basement 'Separate Entrance'      ${sepEntrance.toLocaleString().padStart(7)}  ${pct(sepEntrance)}`);
  console.log(`Basement 'Apartment'              ${apartment.toLocaleString().padStart(7)}  ${pct(apartment)}`);
  console.log(`Basement 'Walk-Out'               ${walkout.toLocaleString().padStart(7)}  ${pct(walkout)}`);
  console.log('');
  console.log(`kitchen + (sep entrance|apt|walkout)  ${kbgAndSep.toLocaleString().padStart(7)}   <- strong suite signal`);
  console.log(`kitchen ONLY (no access signal)       ${kbgOnly.toLocaleString().padStart(7)}   <- second kitchen, maybe in-law`);
  console.log(`access signal but NO second kitchen   ${sepNoKbg.toLocaleString().padStart(7)}   <- conversion candidate, not a suite today`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
