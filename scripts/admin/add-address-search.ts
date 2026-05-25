/**
 * Shadow MLS — Make street addresses searchable in the terminal search bar.
 *
 * `UnparsedAddress` has always been STORED on every Typesense doc (for display) but
 * was never an INDEXED field, so `query_by=UnparsedAddress` returned HTTP 400 and
 * address typeahead was impossible. This script:
 *   1. ALTERs the live `properties` collection to add UnparsedAddress as an indexed
 *      (non-faceted) string — definition pulled from typesenseSchema (source of truth).
 *   2. VERIFIES the existing 83k docs got indexed (adding a field re-indexes from the
 *      stored raw docs). If not, it falls back to an export → import(action:'update')
 *      reindex of just id + UnparsedAddress.
 *
 * Reads/writes ONLY Typesense — NO Supabase (bulk Supabase reads exhaust the IO budget;
 * see memory). Non-destructive + idempotent: re-running is a no-op once indexed.
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/add-address-search.ts          # dry-run
 *   npx.cmd tsx --env-file=.env scripts/admin/add-address-search.ts --apply  # write
 */
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELD = 'UnparsedAddress';
const CHUNK = 2000;
// A token that appears in a large share of real addresses — used to prove the
// existing docs actually got indexed (not just newly-written ones).
const PROBE = 'street';

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});

async function fieldExists(): Promise<boolean> {
  const coll: any = await ts.collections(COLLECTION).retrieve();
  return (coll.fields || []).some((f: any) => f.name === FIELD);
}

async function alterCollection() {
  if (await fieldExists()) {
    console.log(`✅ '${FIELD}' already a schema field — no alter needed.`);
    return;
  }
  const def = (typesenseSchema.fields as any[]).find((f) => f.name === FIELD);
  if (!def) throw new Error(`${FIELD} not found in typesenseSchema.fields — declare it there first.`);
  console.log(`Adding indexed field: ${JSON.stringify(def)}`);
  if (!APPLY) {
    console.log('   (dry-run — skipping alter)');
    return;
  }
  await ts.collections(COLLECTION).update({ fields: [def] } as any);
  console.log('   ✅ Collection altered.');
}

async function probeIndexed(): Promise<number> {
  try {
    const r: any = await ts.collections(COLLECTION).documents().search({
      q: PROBE,
      query_by: FIELD,
      per_page: 0,
    });
    return r.found ?? 0;
  } catch (e: any) {
    console.log(`   probe failed: ${e?.message || e}`);
    return -1;
  }
}

async function reindexAddresses() {
  console.log('\nExisting docs not indexed by the alter — running export → import(update) reindex...');
  const raw = (await ts
    .collections(COLLECTION)
    .documents()
    .export({ include_fields: `id,${FIELD}` })) as unknown as string;
  const lines = raw.split('\n').filter((l) => l.trim());
  console.log(`Exported ${lines.length.toLocaleString()} docs.`);

  const updates: string[] = [];
  for (const line of lines) {
    const doc = JSON.parse(line) as { id: string; UnparsedAddress?: string };
    if (!doc.id) continue;
    updates.push(JSON.stringify({ id: doc.id, [FIELD]: doc.UnparsedAddress ?? '' }));
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

async function main() {
  console.log(`\n🏠 Add Address Search  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
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

  let found = await probeIndexed();
  console.log(`\nProbe: query_by=${FIELD} q="${PROBE}" → found ${found.toLocaleString()}`);
  if (found === 0) {
    await reindexAddresses();
    found = await probeIndexed();
    console.log(`Re-probe: found ${found.toLocaleString()}`);
  }

  if (found > 0) {
    console.log('\n✅ Address search is live.');
  } else {
    console.error('\n❌ Address still not searchable — investigate before relying on it.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
