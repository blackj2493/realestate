// scripts/admin/addDelistedFields.ts
/**
 * Add the de-listed fields (DaysOnMarket, TransactionType, OriginalListPrice)
 * to the LIVE sold_listings collection. Idempotent: skips fields that already
 * exist. Dry-run prints the live field list; --apply performs the alter.
 *
 * Run:  npx tsx scripts/admin/addDelistedFields.ts            (dry-run)
 *       npx tsx scripts/admin/addDelistedFields.ts --apply
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { SOLD_LISTINGS_COLLECTION } from '../../src/lib/typesense/soldListingsSchema';

if (!process.env.TYPESENSE_ADMIN_API_KEY) {
  console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
  process.exit(1);
}

const NEW_FIELDS = [
  { name: 'DaysOnMarket', type: 'int32' as const, facet: false, optional: true, sort: true },
  { name: 'TransactionType', type: 'string' as const, facet: true, optional: true },
  { name: 'OriginalListPrice', type: 'int32' as const, facet: false, optional: true, sort: true },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new Typesense.Client({
    nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 60,
  });
  const live = await client.collections(SOLD_LISTINGS_COLLECTION).retrieve();
  const existing = new Set(live.fields!.map((f: any) => f.name));
  console.log(`Live fields: ${[...existing].join(', ')}`);
  const toAdd = NEW_FIELDS.filter((f) => !existing.has(f.name));
  if (toAdd.length === 0) return console.log('✅ Nothing to add.');
  console.log(`Will add: ${toAdd.map((f) => f.name).join(', ')}`);
  if (!apply) return console.log('Dry-run. Re-run with --apply.');
  await client.collections(SOLD_LISTINGS_COLLECTION).update({ fields: toAdd as any });
  console.log('✅ Fields added.');
}

main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
