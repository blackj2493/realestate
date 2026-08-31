/**
 * Read-only: what the rent ladder actually returns for one listing, and what the live
 * document currently carries.
 *
 * WHY. `fetchRentAVM` has returned `basis` and `sample_count` since 133, and the
 * document dropped both — so the Underwriting Sandbox printed a rent with no way to
 * tell forty signed leases from three asks. This prints the two side by side, which is
 * how you confirm the new fields are populated after a sync or a --resync-index pass.
 *
 * Usage:
 *   npx tsx scripts/admin/_probeRentProvenance.ts W13714292
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { fetchRentAVM, fetchSuiteRent, fetchMainUnitRent } from '../worker/services/rentAVM';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const KEY = process.argv[2];

async function main() {
  if (!KEY) {
    console.error('❌ Pass a listing key, e.g. W13714292.');
    process.exit(1);
  }

  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const { rows } = await pg.query<{ full_payload: Record<string, unknown> }>(
    'SELECT full_payload FROM listings WHERE listing_key = $1', [KEY]
  );
  await pg.end();
  if (rows.length === 0) {
    console.error(`❌ ${KEY} is not in listings.`);
    process.exit(1);
  }
  const raw = rows[0].full_payload as Record<string, any>;

  console.log(`\n🏠 ${KEY} — ${raw.UnparsedAddress ?? '(no address)'}`);
  console.log(`   ${raw.PropertySubType}, ${raw.City} / ${raw.CityRegion}`);
  console.log(`   beds ${raw.BedroomsAboveGrade}+${raw.BedroomsBelowGrade} (total ${raw.BedroomsTotal}), baths ${raw.BathroomsTotalInteger}`);

  const wholeHome = await fetchRentAVM({
    city: raw.City || '',
    cityRegion: raw.CityRegion || raw.City || '',
    propertySubType: raw.PropertySubType || '',
    bedroomsTotal: raw.BedroomsTotal || 0,
    bedroomsAboveGrade: raw.BedroomsAboveGrade,
    bedroomsBelowGrade: raw.BedroomsBelowGrade,
    bathroomsTotal: raw.BathroomsTotalInteger || 0,
    county: raw.CountyOrParish,
  });
  const mainUnit = await fetchMainUnitRent({
    city: raw.City || '',
    cityRegion: raw.CityRegion || raw.City || '',
    propertySubType: raw.PropertySubType || '',
    bedroomsTotal: raw.BedroomsTotal || 0,
    bedroomsAboveGrade: raw.BedroomsAboveGrade,
    bedroomsBelowGrade: raw.BedroomsBelowGrade,
    bathroomsTotal: raw.BathroomsTotalInteger || 0,
    county: raw.CountyOrParish,
    wholeHome,
  });
  const suite = await fetchSuiteRent({
    city: raw.City || '',
    cityRegion: raw.CityRegion || raw.City || '',
    bedroomsBelowGrade: raw.BedroomsBelowGrade,
  });

  const show = (name: string, r: { has_data: boolean; match_tier: string | null; basis?: string | null; sample_count?: number | null }, monthly: number) => {
    console.log(`\n   ${name}`);
    if (!r.has_data) { console.log('     no comp'); return; }
    console.log(`     monthly       $${Math.round(monthly).toLocaleString()}`);
    console.log(`     match_tier    ${r.match_tier ?? '(none)'}`);
    console.log(`     basis         ${r.basis ?? '(none)'}`);
    console.log(`     sample_count  ${r.sample_count ?? '(none)'}`);
  };

  console.log('\n── what the ladder returns now ──────────────────────────────');
  show('whole home', wholeHome, wholeHome.annual_rent / 12);
  show('main unit', mainUnit, mainUnit.annual_rent / 12);
  show('suite', suite, suite.monthly_rent);

  console.log('\n── what the live document carries ───────────────────────────');
  const res = await fetch(
    `https://${TYPESENSE_HOST}/collections/properties/documents/search` +
    `?q=*&filter_by=${encodeURIComponent(`id:=\`${KEY}\``)}&per_page=1&exclude_fields=RawImages`,
    { headers: { 'X-TYPESENSE-API-KEY': process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY ?? '' } }
  );
  const json = (await res.json()) as { hits?: Array<{ document: Record<string, unknown> }> };
  const doc = json.hits?.[0]?.document;
  if (!doc) { console.log('   absent from the index'); return; }
  for (const f of ['gross_yield_est', 'rent_match_tier', 'rent_basis', 'rent_sample_count',
                   'suite_rent_est', 'suite_rent_tier', 'suite_rent_basis', 'suite_rent_sample_count']) {
    console.log(`   ${f.padEnd(26)} ${doc[f] === undefined ? '(field absent)' : JSON.stringify(doc[f])}`);
  }
  console.log('');
}

main().catch((err) => { console.error('❌ Fatal:', err); process.exit(1); });
