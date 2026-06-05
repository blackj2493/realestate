/**
 * Add the `DealType` faceted field to the live `sold_listings` collection so the
 * sold route can filter sold vs leased by REAL values (replacing the $50k price
 * proxy). After altering, run `npx tsx scripts/worker/soldIndexer.ts backfill` to
 * repopulate DealType on the 180-day window (the backfill upserts every doc).
 * Reads/writes ONLY Typesense. Idempotent.
 *   npx tsx scripts/admin/add-sold-deal-type.ts          # dry-run
 *   npx tsx scripts/admin/add-sold-deal-type.ts --apply  # alter
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { soldListingsSchema, SOLD_LISTINGS_COLLECTION } from '@/lib/typesense/soldListingsSchema';

const APPLY = process.argv.includes('--apply');
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELD = 'DealType';
const ts = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function main() {
  if (!KEY) { console.error('❌ TYPESENSE_ADMIN_API_KEY not set'); process.exit(1); }
  const coll: AnyObj = await ts.collections(SOLD_LISTINGS_COLLECTION).retrieve();
  if ((coll.fields || []).some((f: AnyObj) => f.name === FIELD)) {
    console.log(`✅ '${FIELD}' already present — no alter needed.`); return;
  }
  const def = (soldListingsSchema.fields as AnyObj[]).find((f) => f.name === FIELD);
  if (!def) throw new Error(`${FIELD} missing from soldListingsSchema.fields`);
  console.log(`Adding field: ${JSON.stringify(def)}`);
  if (!APPLY) { console.log('(dry-run — re-run with --apply)'); return; }
  await ts.collections(SOLD_LISTINGS_COLLECTION).update({ fields: [def] } as AnyObj);
  console.log('✅ Altered. Now run: npx tsx scripts/worker/soldIndexer.ts backfill');
}
main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
