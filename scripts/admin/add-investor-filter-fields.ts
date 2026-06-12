/**
 * Shadow MLS — index the investor-filter fields on the live `properties` collection.
 *
 * isDistressed / hasSecondarySuitePotential / calculatedDOM have always been STORED
 * on every doc (transformer.ts writes them) but were never DECLARED, so every
 * filter_by/sort_by on them returned HTTP 400 (audit HIGH-5). This script:
 *   1. ALTERs the collection to add each missing field (definitions pulled from
 *      typesenseSchema — the source of truth; declare there first).
 *   2. VERIFIES docs got indexed (an alter re-indexes from the stored raw docs);
 *      falls back to export → import(action:'update') if not.
 *
 * Typesense ONLY — zero Supabase reads (IO budget). Idempotent: re-running no-ops.
 *
 * Usage:
 *   npx tsx scripts/admin/add-investor-filter-fields.ts          # dry-run
 *   npx tsx scripts/admin/add-investor-filter-fields.ts --apply  # alter live
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELDS = ['isDistressed', 'hasSecondarySuitePotential', 'calculatedDOM'] as const;
const CHUNK = 2000;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function missingFields(): Promise<string[]> {
  const coll: AnyObj = await ts.collections(COLLECTION).retrieve();
  const present = new Set((coll.fields || []).map((f: AnyObj) => f.name));
  return FIELDS.filter((f) => !present.has(f));
}

async function alterCollection(missing: string[]) {
  const defs = missing.map((name) => {
    const def = (typesenseSchema.fields as AnyObj[]).find((f) => f.name === name);
    if (!def) throw new Error(`${name} not found in typesenseSchema.fields — declare it there first.`);
    return def;
  });
  console.log(`Adding fields: ${defs.map((d) => JSON.stringify(d)).join('\n               ')}`);
  if (!APPLY) {
    console.log('   (dry-run — skipping alter)');
    return;
  }
  await ts.collections(COLLECTION).update({ fields: defs } as AnyObj);
  console.log('   ✅ Collection altered.');
}

/** Prove a field is filterable by counting on it (HTTP 400 = not indexed). */
async function countWhere(filterBy: string): Promise<number> {
  try {
    const r: AnyObj = await ts.collections(COLLECTION).documents().search({
      q: '*',
      query_by: 'City',
      filter_by: filterBy,
      per_page: 0,
    });
    return r.found ?? 0;
  } catch (e: AnyObj) {
    console.log(`   count(${filterBy}) failed: ${e?.message || e}`);
    return -1;
  }
}

async function reindexFromStored() {
  console.log('\nExisting docs not indexed by the alter — export → import(update) reindex...');
  const raw = (await ts
    .collections(COLLECTION)
    .documents()
    .export({ include_fields: `id,${FIELDS.join(',')}` })) as unknown as string;
  const lines = raw.split('\n').filter((l) => l.trim());
  console.log(`Exported ${lines.length.toLocaleString()} docs.`);

  const updates: string[] = [];
  for (const line of lines) {
    const doc = JSON.parse(line) as AnyObj;
    if (!doc.id) continue;
    const u: AnyObj = { id: doc.id };
    for (const f of FIELDS) if (doc[f] !== undefined) u[f] = doc[f];
    updates.push(JSON.stringify(u));
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

async function report(): Promise<boolean> {
  const [distressed, notDistressed, suite, dom] = await Promise.all([
    countWhere('isDistressed:=true'),
    countWhere('isDistressed:=false'),
    countWhere('hasSecondarySuitePotential:=true'),
    countWhere('calculatedDOM:>=0'),
  ]);
  console.log(`\nisDistressed true/false = ${distressed.toLocaleString()} / ${notDistressed.toLocaleString()}`);
  console.log(`hasSecondarySuitePotential true = ${suite.toLocaleString()}`);
  console.log(`calculatedDOM >= 0 = ${dom.toLocaleString()}`);
  // Filterability is what we're proving; -1 means HTTP 400 (not indexed).
  return distressed >= 0 && notDistressed >= 0 && suite >= 0 && dom >= 0 && (distressed + notDistressed) > 0;
}

async function main() {
  console.log(`\n🏷️  Add investor filter fields  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }

  const missing = await missingFields();
  if (missing.length === 0) {
    console.log('✅ All fields already declared on the live collection.');
  } else {
    await alterCollection(missing);
  }

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to alter the live collection.');
    return;
  }

  let ok = await report();
  if (!ok) {
    await reindexFromStored();
    ok = await report();
  }
  if (ok) {
    console.log('\n✅ Investor filter fields are now filterable.');
  } else {
    console.error('\n❌ Fields still not filterable — investigate before relying on them.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
