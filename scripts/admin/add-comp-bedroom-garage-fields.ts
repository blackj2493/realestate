/**
 * Shadow MLS — Add the comparables-matcher fields to BOTH search collections.
 *
 * The listing page "comparable properties" band now scores bedrooms on the
 * above/below-grade SPLIT (not the raw total — a 4+2 is not a 6+0) and adds a
 * garage-capacity (CoveredSpaces) signal. That needs these fields indexed:
 *
 *   properties     → CoveredSpaces                                  (bedroom split already added)
 *   sold_listings  → BedroomsAboveGrade, BedroomsBelowGrade, CoveredSpaces
 *
 * This script does ONLY the schema alter (a metadata op). It does NOT reindex.
 * Field DEFS come from the schema source-of-truth modules, with `sort` stripped
 * (Typesense 400s if you try to make a field sortable on a populated collection).
 *
 * To POPULATE existing docs afterwards:
 *   sold_listings — rebuild the rolling 180-day window (it's a disposable cache):
 *       npx tsx scripts/worker/soldIndexer.ts backfill
 *   properties    — forward-fills automatically as listings change on each delta
 *       sync (transformer now emits CoveredSpaces). For an immediate full
 *       populate, re-run the active transformer over every doc (the daily
 *       ingester upsert is the supported path; there is no standalone reindex).
 *
 * Reads/writes ONLY Typesense — no Supabase. Non-destructive + idempotent: adding
 * an optional field is a metadata op and re-running skips fields already present.
 *
 * Usage:
 *   npx tsx scripts/admin/add-comp-bedroom-garage-fields.ts          # dry-run
 *   npx tsx scripts/admin/add-comp-bedroom-garage-fields.ts --apply  # alter live
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';
import { soldListingsSchema, SOLD_LISTINGS_COLLECTION } from '@/lib/typesense/soldListingsSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

// Which fields each collection needs, and the schema module to pull each def from.
const PLAN: Array<{ collection: string; schemaFields: AnyObj[]; fields: string[] }> = [
  { collection: 'properties', schemaFields: typesenseSchema.fields as AnyObj[], fields: ['CoveredSpaces'] },
  {
    collection: SOLD_LISTINGS_COLLECTION,
    schemaFields: soldListingsSchema.fields as AnyObj[],
    fields: ['BedroomsAboveGrade', 'BedroomsBelowGrade', 'CoveredSpaces'],
  },
];

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});

async function existingFieldNames(collection: string): Promise<Set<string>> {
  const coll: AnyObj = await ts.collections(collection).retrieve();
  return new Set((coll.fields || []).map((f: AnyObj) => f.name as string));
}

async function alterCollection(collection: string, schemaFields: AnyObj[], wanted: string[]) {
  const present = await existingFieldNames(collection);
  const toAdd = wanted.filter((name) => !present.has(name));

  if (toAdd.length === 0) {
    console.log(`✅ ${collection}: ${wanted.join(', ')} already present — no alter needed.`);
    return;
  }

  // Pull defs from the schema (source of truth). Strip `sort` — Typesense returns 400
  // if you try to alter a field to be sortable on an already-populated collection.
  const defs = toAdd.map((name) => {
    const def = schemaFields.find((f) => f.name === name);
    if (!def) throw new Error(`${name} not found in ${collection} schema — declare it there first.`);
    return { name: def.name, type: def.type, facet: def.facet ?? false, optional: true };
  });

  console.log(`\n${collection}: adding`, JSON.stringify(defs));
  if (!APPLY) {
    console.log('   (dry-run — re-run with --apply to alter the live collection)');
    return;
  }
  await ts.collections(collection).update({ fields: defs } as AnyObj);
  console.log('   ✅ Collection altered.');
}

async function main() {
  console.log(`\n🛏️🚗  Add comparables bedroom-split + garage fields  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(60));
  if (!KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }

  for (const { collection, schemaFields, fields } of PLAN) {
    await alterCollection(collection, schemaFields, fields);
  }

  if (APPLY) {
    console.log('\nNext — populate existing docs:');
    console.log('   sold_listings:  npx tsx scripts/worker/soldIndexer.ts backfill');
    console.log('   properties:     forward-fills on the next delta sync (CoveredSpaces).');
  }
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
