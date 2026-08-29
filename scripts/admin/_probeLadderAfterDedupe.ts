/**
 * READ-ONLY. Walk the rent ladder for one listing against a DEDUPED in-memory index,
 * so we can see what it gets after the fix — not just that the bad cohort is gone.
 *
 * Usage: npx tsx scripts/admin/_probeLadderAfterDedupe.ts C13666180
 */
import 'dotenv/config';
import { Client } from 'pg';
import { createRentAccumulator, MIN_COHORT_SAMPLES } from '../worker/services/rentModel';
import { bedSplit } from '@/lib/listings/bedSplit';
import { subTypeFamily } from '@/lib/listings/subTypeFamily';

const KEY = process.argv[2] ?? 'C13666180';
const DEDUP = `coalesce(nullif(property_hash,''), nullif(norm_address,''), listing_key)`;

async function build(client: Client, deduped: boolean) {
  const distinct = deduped ? `DISTINCT ON (${DEDUP})` : '';
  const order = deduped
    ? `ORDER BY ${DEDUP}, last_seen_at DESC NULLS LAST, listing_key DESC`
    : '';
  const { rows } = await client.query(
    `SELECT ${distinct} list_price, city, city_region, property_sub_type,
            full_payload->>'TransactionType'       AS transaction_type,
            full_payload->>'BedroomsTotal'         AS bt,
            full_payload->>'BedroomsAboveGrade'    AS ba,
            full_payload->>'BedroomsBelowGrade'    AS bb,
            full_payload->>'BathroomsTotalInteger' AS bath,
            full_payload->>'CountyOrParish'        AS county,
            full_payload->>'UnparsedAddress'       AS addr
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ '(leas|rent)' ${order}`);
  const num = (v: string | null) => (/^[0-9]+$/.test(v ?? '') ? parseInt(v as string, 10) : null);
  const acc = createRentAccumulator();
  for (const r of rows) {
    acc.add({
      transactionType: r.transaction_type,
      closePrice: null,
      listPrice: r.list_price != null ? Number(r.list_price) : null,
      city: r.city, cityRegion: r.city_region, propertySubType: r.property_sub_type,
      bedroomsTotal: num(r.bt), bedroomsAboveGrade: num(r.ba), bedroomsBelowGrade: num(r.bb),
      bathroomsTotal: num(r.bath), county: r.county, unparsedAddress: r.addr,
    });
  }
  return { rows: rows.length, index: acc.finalize() };
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.DIRECT_DB_URL });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");

  const { rows: l } = await c.query(
    `SELECT list_price, city, btrim(coalesce(city_region,'')) AS cr, btrim(coalesce(property_sub_type,'')) AS st,
            full_payload->>'BedroomsTotal' AS bt, full_payload->>'BedroomsAboveGrade' AS ba,
            full_payload->>'BedroomsBelowGrade' AS bb, full_payload->>'BathroomsTotalInteger' AS bath,
            full_payload->>'CountyOrParish' AS county, full_payload->>'UnparsedAddress' AS addr
       FROM listings WHERE listing_key = $1`, [KEY]);
  if (!l.length) { console.log('not found'); await c.end(); return; }
  const s = l[0];
  const num = (v: string | null) => (/^[0-9]+$/.test(v ?? '') ? parseInt(v as string, 10) : null);
  const split = bedSplit({ BedroomsTotal: num(s.bt), BedroomsAboveGrade: num(s.ba), BedroomsBelowGrade: num(s.bb) });
  const bath = num(s.bath);
  const fam = subTypeFamily(s.st);
  console.log(`${s.addr} — $${Number(s.list_price).toLocaleString()}  ${s.st}  ${split?.above}+${split?.den}bd ${bath}ba  ${s.cr}\n`);

  // The ladder walk fetchRentAVM performs: split cohorts across all rungs, then merged.
  const walk = (index: Awaited<ReturnType<typeof build>>['index']) => {
    const dims = [
      split ? { above: split.above, den: split.den } : null,
      { above: null as number | null, den: null as number | null },
    ].filter(Boolean) as Array<{ above: number | null; den: number | null }>;
    for (const d of dims) {
      const bedMatch = (r: (typeof index)[number]) =>
        d.above === null
          ? r.bedrooms_above === null && r.bedrooms_total === num(s.bt)
          : r.bedrooms_above === d.above && r.den === d.den;
      const tiers: Array<[string, (r: (typeof index)[number]) => boolean]> = [
        ['nbhd', (r) => r.match_tier === 'nbhd' && r.city_region === s.cr && r.property_sub_type === s.st && r.bathrooms === bath],
        ['city_bath', (r) => r.match_tier === 'city_bath' && r.city === s.city && r.property_sub_type === s.st && r.bathrooms === bath],
        ['city', (r) => r.match_tier === 'city' && r.city === s.city && r.property_sub_type === s.st],
        ['city_family', (r) => r.match_tier === 'city_family' && r.city === s.city && r.sub_type_family === fam],
        ['county', (r) => r.match_tier === 'county' && r.county === (s.county ?? '').trim() && r.property_sub_type === s.st],
      ];
      for (const [tier, pred] of tiers) {
        const hit = index.find((r) => pred(r) && bedMatch(r));
        if (hit) return { tier, rent: hit.avg_rent, n: hit.sample_count, split: d.above !== null };
      }
    }
    return null;
  };

  for (const deduped of [false, true]) {
    const built = await build(c, deduped);
    const hit = walk(built.index);
    console.log(`${deduped ? 'DEDUPED ' : 'TODAY   '} rows=${built.rows.toLocaleString()} cohorts=${built.index.length.toLocaleString()}`);
    console.log(hit
      ? `          -> $${hit.rent.toLocaleString()}/mo  via ${hit.tier} (n=${hit.n}, ${hit.split ? 'split' : 'merged'})  ` +
        `gross yield ${(((hit.rent * 12) / Number(s.list_price)) * 100).toFixed(2)}%`
      : `          -> no comp (floor is ${MIN_COHORT_SAMPLES})`);
  }
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
