/** READ-ONLY. Compare the SERVED Typesense doc, the stored Postgres row, and what the
 *  current code would compute, for one listing. */
import 'dotenv/config';
import { Client } from 'pg';
import { fetchRentAVM, fetchSuiteRent, fetchMainUnitRent } from '../worker/services/rentAVM';
import { calculateFinancialMetrics } from '../worker/services/financialMetrics';
import { resolveRatioPrice, fetchMillRate } from '../worker/services/ratioPriceCalculator';
import { hasObservedSuite } from '@/lib/listings/observedSuite';

const KEY = process.argv[2] ?? 'N13698568';
const HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.DIRECT_DB_URL });
  await client.connect();
  const { rows } = await client.query(
    `SELECT cap_rate_est, rent_match_tier, suite_rent_est, full_payload FROM listings WHERE listing_key=$1`, [KEY]);
  if (!rows.length) { console.log('not found'); await client.end(); return; }
  const raw = rows[0].full_payload as Record<string, unknown>;

  const res = await fetch(`https://${HOST}/collections/properties/documents/${KEY}`, {
    headers: { 'X-TYPESENSE-API-KEY': process.env.TYPESENSE_ADMIN_API_KEY ?? '' },
  });
  const doc = res.ok ? await res.json() : null;

  console.log('SERVED (Typesense)');
  if (!doc) console.log('  not in index');
  else {
    for (const f of ['cap_rate_est', 'gross_yield_est', 'net_monthly_cashflow', 'rent_match_tier', 'suite_rent_est', 'ListPrice']) {
      console.log(`  ${f.padEnd(22)} ${JSON.stringify(doc[f])}`);
    }
    const gy = Number(doc.gross_yield_est), lp = Number(doc.ListPrice);
    if (gy > 0 && lp > 0) console.log(`  -> implied Monthly Rent  $${Math.round((gy / 100) * lp / 12).toLocaleString()}`);
  }

  console.log('\nSTORED (Postgres)');
  console.log(`  cap_rate_est ${rows[0].cap_rate_est}   rent_match_tier ${rows[0].rent_match_tier}   suite_rent_est ${rows[0].suite_rent_est}`);

  console.log('\nWHAT CURRENT CODE COMPUTES');
  const rentAVM = await fetchRentAVM({
    city: (raw.City as string) || '', cityRegion: (raw.CityRegion as string) || (raw.City as string) || '',
    propertySubType: (raw.PropertySubType as string) || '', bedroomsTotal: Number(raw.BedroomsTotal) || 0,
    bedroomsAboveGrade: raw.BedroomsAboveGrade as number, bedroomsBelowGrade: raw.BedroomsBelowGrade as number,
    bathroomsTotal: Number(raw.BathroomsTotalInteger) || 0, county: raw.CountyOrParish as string,
  });
  let rent = rentAVM;
  let suite = { monthly_rent: 0, monthly_rent_p10: 0, has_data: false, match_tier: null as string | null };
  const observed = hasObservedSuite(raw as never);
  console.log(`  hasObservedSuite=${observed}   whole-home comp $${Math.round(rentAVM.annual_rent / 12).toLocaleString()}/mo (${rentAVM.match_tier})`);
  if (rentAVM.has_data && observed) {
    const [s, m] = await Promise.all([
      fetchSuiteRent({ city: (raw.City as string) || '', cityRegion: (raw.CityRegion as string) || '', bedroomsBelowGrade: raw.BedroomsBelowGrade as number }),
      fetchMainUnitRent({
        city: (raw.City as string) || '', cityRegion: (raw.CityRegion as string) || (raw.City as string) || '',
        propertySubType: (raw.PropertySubType as string) || '', bedroomsTotal: Number(raw.BedroomsTotal) || 0,
        bedroomsAboveGrade: raw.BedroomsAboveGrade as number, bedroomsBelowGrade: raw.BedroomsBelowGrade as number,
        bathroomsTotal: Number(raw.BathroomsTotalInteger) || 0, county: raw.CountyOrParish as string,
        wholeHome: rentAVM,
      }),
    ]);
    console.log(`  suite $${s.monthly_rent}/mo (${s.match_tier})   main-unit $${Math.round(m.annual_rent / 12).toLocaleString()}/mo (${m.match_tier})`);
    if (s.has_data && m.has_data) { suite = s; rent = m; }
    else console.log('  -> all-or-nothing: no suite line published');
  }
  const region = (raw.CityRegion as string) || (raw.City as string) || '';
  const [ratio, mill] = await Promise.all([
    resolveRatioPrice({ listPrice: Number(raw.ListPrice) || 0, propertySubType: (raw.PropertySubType as string) || '', cityRegion: region }),
    fetchMillRate(region),
  ]);
  const m2 = calculateFinancialMetrics({
    annual_rent: rent.annual_rent, annual_rent_p10: rent.annual_rent_p10, has_rent_data: rent.has_data,
    calculation_price: ratio.calculation_price, is_price_discovery: ratio.is_price_discovery,
    propertySubType: (raw.PropertySubType as string) || '', listPrice: Number(raw.ListPrice) || 0,
    transactionType: raw.TransactionType as string, taxAnnualAmount: (raw.TaxAnnualAmount as number) ?? null,
    associationFee: (raw.AssociationFee as number) ?? null, maintenanceExpense: null, insuranceExpense: null,
    baseMillRate: mill.base_mill_rate,
    isCondo: !!(String(raw.PropertyType ?? '').includes('Condo') || raw.CondoCorpNumber),
    suite_monthly_rent: suite.has_data ? suite.monthly_rent : 0,
    suite_monthly_rent_p10: suite.has_data ? suite.monthly_rent_p10 : 0,
  });
  console.log(`  cap_rate_est ${m2.cap_rate_est}   gross_yield_est ${m2.gross_yield_est}   annual_revenue $${m2.annual_revenue.toLocaleString()}`);
  console.log(`  -> Monthly Rent the sandbox would show  $${Math.round((m2.gross_yield_est / 100) * (Number(raw.ListPrice) || 0) / 12).toLocaleString()}`);
  console.log(`  TaxAnnualAmount=${raw.TaxAnnualAmount}  millRate=${mill.base_mill_rate}`);
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
