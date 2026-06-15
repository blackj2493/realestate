/**
 * Verify the amenity-proximity backfill: confirms NearestGroceryKm / NearestRecCentreKm
 * are populated and filterable on the live `properties` collection.
 *
 * Usage: npx.cmd tsx --env-file=.env scripts/admin/verify-amenity-backfill.ts
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import Typesense from 'typesense';

const ts = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: process.env.TYPESENSE_ADMIN_API_KEY || '',
  connectionTimeoutSeconds: 120,
});

async function count(filter?: string): Promise<number> {
  const res: any = await ts
    .collections('properties')
    .documents()
    .search({ q: '*', query_by: 'UnparsedAddress', filter_by: filter, per_page: 0 } as any);
  return res.found as number;
}

async function main() {
  const total = await count();
  const withGrocery = await count('NearestGroceryKm:<99');
  const within1kmG = await count('NearestGroceryKm:<=1');
  const within500mG = await count('NearestGroceryKm:<=0.5');
  const withRec = await count('NearestRecCentreKm:<99');
  const within1kmR = await count('NearestRecCentreKm:<=1');

  console.log('\n📊 Amenity backfill verification (properties collection)');
  console.log('='.repeat(56));
  console.log(`Total docs                  : ${total.toLocaleString()}`);
  console.log(`Grocery distance present    : ${withGrocery.toLocaleString()} (${pct(withGrocery, total)})`);
  console.log(`  …within 1.0 km            : ${within1kmG.toLocaleString()} (${pct(within1kmG, total)})`);
  console.log(`  …within 0.5 km            : ${within500mG.toLocaleString()} (${pct(within500mG, total)})`);
  console.log(`Recreation distance present : ${withRec.toLocaleString()} (${pct(withRec, total)})`);
  console.log(`  …within 1.0 km            : ${within1kmR.toLocaleString()} (${pct(within1kmR, total)})`);

  // Sample a few docs with the actual values.
  const sample: any = await ts.collections('properties').documents().search({
    q: '*',
    query_by: 'UnparsedAddress',
    filter_by: 'NearestGroceryKm:<99',
    include_fields: 'id,UnparsedAddress,NearestGroceryKm,NearestGroceryName,NearestRecCentreKm,NearestRecCentreName',
    per_page: 3,
  } as any);
  console.log('\nSample docs:');
  for (const h of sample.hits ?? []) {
    const d = h.document;
    console.log(`  ${d.UnparsedAddress ?? d.id}`);
    console.log(`     grocery: ${d.NearestGroceryName || '—'} @ ${d.NearestGroceryKm} km | rec: ${d.NearestRecCentreName || '—'} @ ${d.NearestRecCentreKm} km`);
  }
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
