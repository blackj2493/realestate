/**
 * Shadow MLS — Make sale-vs-lease filterable in the `properties` collection.
 *
 * `TransactionType` ("For Sale" / "For Lease") has always been STORED on every
 * Typesense doc (the transformer writes it — transformer.ts) but was never an
 * INDEXED field, so `TransactionType:=...` returned HTTP 400 and the dashboard had
 * to separate sale/lease with a ListPrice ($50k) proxy. This script:
 *   1. ALTERs the live `properties` collection to add TransactionType as a faceted
 *      string (definition pulled from typesenseSchema — the source of truth).
 *   2. VERIFIES the existing docs got indexed (adding a field re-indexes from the
 *      stored raw docs). If not, falls back to export → import(action:'update') of
 *      just id + TransactionType.
 *
 * Reads/writes ONLY Typesense — NO Supabase (bulk reads exhaust the IO budget; see
 * memory). Non-destructive + idempotent: re-running is a no-op once indexed.
 *
 * Usage:
 *   npx tsx scripts/admin/add-transaction-type.ts          # dry-run
 *   npx tsx scripts/admin/add-transaction-type.ts --apply  # write
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELD = 'TransactionType';
const CHUNK = 2000;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function fieldExists(): Promise<boolean> {
  const coll: AnyObj = await ts.collections(COLLECTION).retrieve();
  return (coll.fields || []).some((f: AnyObj) => f.name === FIELD);
}

async function alterCollection() {
  if (await fieldExists()) {
    console.log(`✅ '${FIELD}' already a schema field — no alter needed.`);
    return;
  }
  const def = (typesenseSchema.fields as AnyObj[]).find((f) => f.name === FIELD);
  if (!def) throw new Error(`${FIELD} not found in typesenseSchema.fields — declare it there first.`);
  console.log(`Adding faceted field: ${JSON.stringify(def)}`);
  if (!APPLY) {
    console.log('   (dry-run — skipping alter)');
    return;
  }
  await ts.collections(COLLECTION).update({ fields: [def] } as AnyObj);
  console.log('   ✅ Collection altered.');
}

/** Count docs matching a TransactionType value (proves the field is filterable). */
async function countByType(value: string): Promise<number> {
  try {
    const r: AnyObj = await ts.collections(COLLECTION).documents().search({
      q: '*',
      query_by: 'City',
      filter_by: `${FIELD}:=\`${value}\``,
      per_page: 0,
    });
    return r.found ?? 0;
  } catch (e: AnyObj) {
    console.log(`   count(${value}) failed: ${e?.message || e}`);
    return -1;
  }
}

async function reindexFromStored() {
  console.log('\nExisting docs not indexed by the alter — running export → import(update) reindex...');
  const raw = (await ts
    .collections(COLLECTION)
    .documents()
    .export({ include_fields: `id,${FIELD}` })) as unknown as string;
  const lines = raw.split('\n').filter((l) => l.trim());
  console.log(`Exported ${lines.length.toLocaleString()} docs.`);

  const updates: string[] = [];
  for (const line of lines) {
    const doc = JSON.parse(line) as { id: string; TransactionType?: string };
    if (!doc.id) continue;
    updates.push(JSON.stringify({ id: doc.id, [FIELD]: doc.TransactionType ?? '' }));
  }

  let done = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = updates.slice(i, i + CHUNK).join('\n');
    await ts.collections(COLLECTION).documents().import(batch, { action: 'update' });
    done += Math.min(CHUNK, updates.length - i);
    console.log(`   …reindexed ${done.toLocaleString()}/${updates.length.toLocaleString()}`);
  }
  console.log('   ✅ Reindex complete.');
}

async function report() {
  const [sale, lease] = await Promise.all([
    countByType('For Sale'),
    countByType('For Lease'),
  ]);
  console.log(`\nDistribution: For Sale = ${sale.toLocaleString()} · For Lease = ${lease.toLocaleString()}`);
  return sale + lease;
}

async function main() {
  console.log(`\n🏷️  Add TransactionType filter  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }

  await alterCollection();

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to alter the live collection.');
    return;
  }

  let classified = await report();
  if (classified <= 0) {
    await reindexFromStored();
    classified = await report();
  }

  if (classified > 0) {
    console.log('\n✅ TransactionType is now filterable.');
  } else {
    console.error('\n❌ Still 0 classified — investigate before relying on it.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
