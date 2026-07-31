/**
 * Shadow MLS — declare and backfill sqft_min / sqft_max on the live `properties`
 * collection.
 *
 * UNLIKE add-investor-filter-fields.ts, these two fields have never been written
 * to any document: the alter declares them, but every existing doc would still be
 * missing them, and the nightly sync only rewrites listings that CHANGED. So an
 * alter alone would leave the size filter matching ~nothing and slowly healing
 * over weeks — the silent-null failure mode. This script therefore computes the
 * values from each doc's own stored BuildingAreaTotal / LivingAreaRange and
 * imports them.
 *
 * DEPLOY ORDER MATTERS, in both directions:
 *
 *   1. Run this BEFORE shipping the UI. Until the backfill lands, `sqft_min:>=1100`
 *      matches zero documents and the filter looks broken rather than empty.
 *
 *   2. Ship the transformer change BEFORE relying on the backfill holding. The
 *      nightly sync writes `properties` with `action: 'upsert'` (sync.ts) — a FULL
 *      document replace — so any listing it touches is rebuilt by whatever
 *      transformer is deployed. Run this against an index whose ETL doesn't yet
 *      emit these fields and the backfill erodes a few thousand listings per night,
 *      silently, with no error anywhere. Re-run this script once after the first
 *      sync on the new code to repair anything lost in the gap.
 *
 * Bounds come from `sqftBoundsFor` — the same function transformer.ts uses — so
 * backfilled docs and freshly-synced docs can never disagree.
 *
 * Typesense ONLY, zero Supabase reads. Idempotent: safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/admin/add-sqft-band-fields.ts           # dry-run + distribution
 *   npx tsx scripts/admin/add-sqft-band-fields.ts --apply   # alter + backfill
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';
import { sqftBoundsFor, SQFT_UNKNOWN } from '@/lib/listings/livingAreaBands';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELDS = ['sqft_min', 'sqft_max'] as const;
const CHUNK = 2000;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 300,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

const n = (x: number) => x.toLocaleString('en-US');

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
  console.log(`\nAdding fields:\n  ${defs.map((d) => JSON.stringify(d)).join('\n  ')}`);
  if (!APPLY) {
    console.log('  (dry-run — skipping alter)');
    return;
  }
  await ts.collections(COLLECTION).update({ fields: defs } as AnyObj);
  console.log('  ✅ Collection altered.');
}

/** Count on a filter. -1 means HTTP 400 — the field isn't indexed. */
async function countWhere(filterBy: string): Promise<number> {
  try {
    const r: AnyObj = await ts.collections(COLLECTION).documents().search({
      q: '*', query_by: 'City', filter_by: filterBy, per_page: 0,
    });
    return r.found ?? 0;
  } catch {
    return -1;
  }
}

interface Plan {
  updates: string[];
  total: number;
  sized: number;
  unsized: number;
  fromExact: number;
  fromBand: number;
}

/** Export every doc's size inputs and compute its interval bounds. */
async function buildPlan(): Promise<Plan> {
  console.log('\nExporting size fields from every document…');
  const raw = (await ts
    .collections(COLLECTION)
    .documents()
    .export({ include_fields: 'id,BuildingAreaTotal,LivingAreaRange' })) as unknown as string;

  const lines = raw.split('\n').filter((l) => l.trim());
  console.log(`  ${n(lines.length)} documents exported.`);

  const plan: Plan = { updates: [], total: 0, sized: 0, unsized: 0, fromExact: 0, fromBand: 0 };
  for (const line of lines) {
    const doc = JSON.parse(line) as AnyObj;
    if (!doc.id) continue;
    plan.total++;

    const b = sqftBoundsFor(doc);
    if (b.lo === SQFT_UNKNOWN) plan.unsized++;
    else {
      plan.sized++;
      // A one-wide interval is an exact BuildingAreaTotal; anything wider is a band.
      if (b.hi - b.lo === 1) plan.fromExact++;
      else plan.fromBand++;
    }
    plan.updates.push(JSON.stringify({ id: doc.id, sqft_min: b.lo, sqft_max: b.hi }));
  }
  return plan;
}

async function importUpdates(updates: string[]) {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = updates.slice(i, i + CHUNK);
    const res = (await ts
      .collections(COLLECTION)
      .documents()
      .import(batch.join('\n'), { action: 'update' })) as unknown as string;

    // import() reports per-document outcomes; a silent partial failure here would
    // leave a slice of the index unfilterable, so surface it rather than trust the
    // absence of a thrown error.
    for (const line of String(res).split('\n')) {
      if (line.trim() && !line.includes('"success":true')) failed++;
    }
    done += batch.length;
    if (done % (CHUNK * 10) === 0 || done === updates.length) {
      console.log(`  …${n(done)}/${n(updates.length)}${failed ? `  (${n(failed)} failed)` : ''}`);
    }
  }
  if (failed) throw new Error(`${failed} document updates failed — index is partially backfilled.`);
}

async function verify(plan: Plan) {
  const [sized, unsized, band1100, over5000] = await Promise.all([
    countWhere('sqft_min:>=0'),
    countWhere(`sqft_min:=${SQFT_UNKNOWN}`),
    countWhere('sqft_min:=1100 && sqft_max:=1500'),
    countWhere('sqft_min:=5000'),
  ]);

  console.log('\nVerification (live counts):');
  console.log(`  reporting a size      ${n(sized)}   (expected ${n(plan.sized)})`);
  console.log(`  no size reported      ${n(unsized)}   (expected ${n(plan.unsized)})`);
  console.log(`  band 1100-1500        ${n(band1100)}`);
  console.log(`  band 5000 +           ${n(over5000)}`);

  if (sized < 0 || unsized < 0) {
    throw new Error('A count returned HTTP 400 — the fields are still not filterable.');
  }
  if (sized !== plan.sized || unsized !== plan.unsized) {
    throw new Error('Live counts disagree with the computed plan — backfill is incomplete.');
  }
  // The open-ended bands are the ones the old ingester parser could not read at
  // all; a zero here means the fix did not reach the index.
  if (over5000 === 0) {
    throw new Error('Zero listings in the "5000 +" band — the open-ended parse is not landing.');
  }
  console.log('\n✅ sqft_min / sqft_max are declared, backfilled and filterable.');
}

async function main() {
  console.log(`\n📐  Add sqft band fields  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }

  const missing = await missingFields();
  if (missing.length === 0) console.log('\nFields already declared on the live collection.');
  else await alterCollection(missing);

  const plan = await buildPlan();
  const pct = plan.total ? ((100 * plan.sized) / plan.total).toFixed(1) : '0';
  console.log('\nComputed bounds:');
  console.log(`  ${n(plan.sized)} of ${n(plan.total)} docs report a size (${pct}%)`);
  console.log(`    from a band          ${n(plan.fromBand)}`);
  console.log(`    from an exact value  ${n(plan.fromExact)}`);
  console.log(`  ${n(plan.unsized)} report none`);

  if (!APPLY) {
    console.log('\nDry-run complete — nothing written. Re-run with --apply.');
    return;
  }

  console.log(`\nBackfilling ${n(plan.updates.length)} documents…`);
  await importUpdates(plan.updates);
  await verify(plan);
}

main().catch((err) => {
  console.error('\n❌ Failed:', err?.message || err);
  process.exit(1);
});
