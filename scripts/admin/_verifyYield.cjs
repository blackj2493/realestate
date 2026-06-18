// TEMP read-only verification: are cap_rate_est / gross_yield_est actually
// populated in the live `properties` collection? Counts For-Sale docs by field.
require('dotenv/config');

// Prefer the real Typesense Cloud node (TYPESENSE_NODES="host:port"); the
// NEXT_PUBLIC_TYPESENSE_HOST is the Railway Next.js app, not the search engine.
const nodeStr = (process.env.TYPESENSE_NODES || '').split(',')[0].trim();
const [nodeHost, nodePort] = nodeStr.split(':');
const host = nodeHost || process.env.NEXT_PUBLIC_TYPESENSE_HOST;
const port = nodePort || process.env.NEXT_PUBLIC_TYPESENSE_PORT || '443';
const protocol = process.env.NEXT_PUBLIC_TYPESENSE_PROTOCOL || 'https';
const apiKey = process.env.TYPESENSE_ADMIN_API_KEY || process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY;

if (!host || !apiKey) { console.error('Missing TYPESENSE host/key in env'); process.exit(1); }

const SALE = 'TransactionType:=`For Sale`';
const searches = [
  { label: 'TOTAL docs',                 filter_by: '' },
  { label: 'For-Sale total',             filter_by: SALE },
  { label: 'For-Sale cap_rate_est>0',    filter_by: `${SALE} && cap_rate_est:>0` },
  { label: 'For-Sale gross_yield_est>0', filter_by: `${SALE} && gross_yield_est:>0` },
  { label: 'For-Sale net_monthly_cashflow!=0', filter_by: `${SALE} && net_monthly_cashflow:!=0` },
  { label: 'For-Sale ExtrapolatedCapRate>0', filter_by: `${SALE} && ExtrapolatedCapRate:>0` },
  { label: 'For-Sale cap_rate_floor>0',  filter_by: `${SALE} && cap_rate_floor:>0` },
];

const body = {
  searches: searches.map((s) => ({
    collection: 'properties',
    q: '*',
    query_by: 'UnparsedAddress',
    filter_by: s.filter_by,
    per_page: 0,
  })),
};

(async () => {
  const url = `${protocol}://${host}:${port}/multi_search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-TYPESENSE-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
  const json = await res.json();
  const total = json.results[1]?.found || 0;
  console.log('\nLive `properties` field population (For-Sale):\n');
  json.results.forEach((r, i) => {
    const label = searches[i].label;
    const found = r.found ?? '?';
    const pct = (i >= 2 && total) ? ` (${((found / total) * 100).toFixed(1)}% of for-sale)` : '';
    console.log(`  ${String(found).padStart(8)}  ${label}${pct}`);
  });
  console.log('');
})();
