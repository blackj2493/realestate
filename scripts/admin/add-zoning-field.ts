/**
 * Shadow MLS — declare `zoning_designation` on the live `properties` collection.
 *
 * CONTEXT (verified 2026-07-01 against the live index):
 *   `zoning_designation` is written by transformer.ts (from the MLS `Zoning` field) and is
 *   STORED on every doc, but the MLS source is ~empty for residential, so it is present-but-
 *   EMPTY everywhere, AND it is undeclared → not filterable (filter_by returns HTTP 400).
 *   Adding it to the schema does NOT populate the Builders "Zoning" column — that needs the
 *   zoning-harvest backfill (scripts/admin/zoning-sources.json, Phase 1). This alter ONLY makes
 *   the field filterable, so it is best run TOGETHER WITH that backfill (cf.
 *   backfill-school-fields.ts) rather than standalone. Kept as a separate script for when the
 *   harvest lands (or to declare the field early if desired).
 *
 * Typesense-only; idempotent (re-running no-ops). Definition is pulled from typesenseSchema
 * (declare there first — already done).
 *
 * Usage:
 *   npx tsx scripts/admin/add-zoning-field.ts          # dry-run (default)
 *   npx tsx scripts/admin/add-zoning-field.ts --apply  # alter the live collection
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELDS = ['zoning_designation'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});

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
  console.log('   ✅ Collection altered (existing docs re-indexed from stored values).');
}

/** Prove the field is now filterable (HTTP 400 = still not indexed) and report populated count. */
async function report() {
  try {
    const nonEmpty: AnyObj = await ts.collections(COLLECTION).documents().search({
      q: '*', query_by: 'City', filter_by: 'zoning_designation:!=`__none__`', per_page: 0,
    });
    console.log(`\n✅ zoning_designation is filterable. Docs with a value = ${(nonEmpty.found ?? 0).toLocaleString()}`);
    console.log('   (Expected ~0 until the Phase 1 zoning-harvest backfill populates it.)');
  } catch (e: AnyObj) {
    console.log(`\n❌ zoning_designation still not filterable: ${(e?.message || e)?.slice?.(0, 200)}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log(`\n🏷️  Declare zoning_designation  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }
  const missing = await missingFields();
  if (missing.length === 0) {
    console.log('✅ zoning_designation already declared on the live collection.');
  } else {
    await alterCollection(missing);
  }
  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to alter the live collection.');
    console.log('NOTE: the field will be filterable but EMPTY until the Phase 1 harvest backfill runs.');
    return;
  }
  await report();
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
