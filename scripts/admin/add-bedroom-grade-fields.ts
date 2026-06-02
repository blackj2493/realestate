/**
 * Shadow MLS — Add the above/below-grade bedroom split to the `properties` collection.
 *
 * `BedroomsAboveGrade` / `BedroomsBelowGrade` power the ledger card's "4+1" label
 * (4 bedrooms above grade, 1 below). Unlike TransactionType (which was already
 * STORED on every doc and only needed indexing), these two fields have NEVER been
 * written to Typesense — the transformer only started emitting them in this change.
 * So this script does ONLY the schema alter; it does NOT reindex.
 *
 * To populate existing docs, run AFTER this:
 *   npx tsx scripts/worker/reindex-from-vault.ts          # (its own --apply/flags)
 * which re-runs transformListing() over listings.full_payload (where the raw
 * BedroomsAboveGrade/BelowGrade already live) and upserts. Forward-fill is automatic
 * on every delta sync once the transformer emits the fields.
 *
 * Reads/writes ONLY Typesense — NO Supabase. Non-destructive + idempotent: adding an
 * optional field is a metadata op, and re-running is a no-op once the fields exist.
 *
 * Usage:
 *   npx tsx scripts/admin/add-bedroom-grade-fields.ts          # dry-run
 *   npx tsx scripts/admin/add-bedroom-grade-fields.ts --apply  # alter live collection
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELDS = ['BedroomsAboveGrade', 'BedroomsBelowGrade'];

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function existingFieldNames(): Promise<Set<string>> {
  const coll: AnyObj = await ts.collections(COLLECTION).retrieve();
  return new Set((coll.fields || []).map((f: AnyObj) => f.name as string));
}

async function main() {
  console.log(`\n🛏️  Add bedroom above/below-grade fields  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }

  const present = await existingFieldNames();
  const toAdd = FIELDS.filter((name) => !present.has(name));

  if (toAdd.length === 0) {
    console.log(`✅ ${FIELDS.join(' & ')} already present — no alter needed.`);
    return;
  }

  // Pull defs from the schema (source of truth), stripping our `sort` flag — Typesense
  // returns 400 if you try to alter a field to be sortable on a populated collection.
  const defs = toAdd.map((name) => {
    const def = (typesenseSchema.fields as AnyObj[]).find((f) => f.name === name);
    if (!def) throw new Error(`${name} not found in typesenseSchema.fields — declare it there first.`);
    return { name: def.name, type: def.type, facet: def.facet ?? false, optional: true };
  });

  console.log('Adding fields:', JSON.stringify(defs));
  if (!APPLY) {
    console.log('\n(dry-run — re-run with --apply to alter the live collection)');
    return;
  }

  await ts.collections(COLLECTION).update({ fields: defs } as AnyObj);
  console.log('   ✅ Collection altered.');
  console.log('\nNext: populate existing docs with');
  console.log('   npx tsx scripts/worker/reindex-from-vault.ts');
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
