/**
 * Shadow MLS — make AssociationFee (monthly maintenance/condo fee) a FILTERABLE +
 * SORTABLE field on the live `properties` collection so the "Maint. Fee" range
 * slider works (it was `index:false`, so `AssociationFee:<=…` returned HTTP 400)
 * and earns a distribution histogram.
 *
 * The field already exists as index:false cargo, so we DROP + RE-ADD it in one
 * update (Typesense can't mutate a field's index flag in place). Re-adding an
 * indexed field re-indexes it from the STORED doc values — the transformer always
 * writes a number (transformer.ts: `AssociationFee = … ?? 0`), so no data is lost.
 * NOT a facet: it's a numeric range, faceting high-cardinality numerics is the
 * RAM hazard the 2026-05-19 RAM POLICY forbids.
 *
 * Reads/writes ONLY Typesense — no Supabase. Idempotent: re-running is a no-op
 * once the field is already indexed.
 *
 *   npx tsx scripts/admin/add-association-fee-index.ts          # dry-run
 *   npx tsx scripts/admin/add-association-fee-index.ts --apply  # write
 */
import 'dotenv/config';
import Typesense from 'typesense';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELD = 'AssociationFee';

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

/** Is the field currently indexed (filterable)? A filter query is the real test. */
async function isFilterable(): Promise<boolean> {
  try {
    await ts
      .collections(COLLECTION)
      .documents()
      .search({ q: '*', query_by: 'City', filter_by: `${FIELD}:>=0`, per_page: 0 });
    return true;
  } catch {
    return false;
  }
}

async function countFilter(filter_by: string): Promise<number> {
  const r: AnyObj = await ts
    .collections(COLLECTION)
    .documents()
    .search({ q: '*', query_by: 'City', filter_by, per_page: 0 });
  return r.found ?? 0;
}

async function main() {
  console.log(`\n🏷️  Index ${FIELD}  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }

  if (await isFilterable()) {
    console.log(`✅ '${FIELD}' is already filterable — nothing to do.`);
    const withFee = await countFilter(`${FIELD}:>=1`);
    console.log(`   docs with ${FIELD} >= 1: ${withFee.toLocaleString()}`);
    return;
  }

  console.log(`'${FIELD}' is not indexed. Plan: drop + re-add as { sort:true, facet:false, optional:true }.`);
  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to alter the live collection.');
    return;
  }

  // Drop + re-add in a single update; re-add re-indexes from stored values.
  await ts.collections(COLLECTION).update({
    fields: [
      { name: FIELD, drop: true },
      { name: FIELD, type: 'float', sort: true, facet: false, optional: true },
    ],
  } as AnyObj);
  console.log('   ✅ Collection altered (drop + re-add).');

  if (!(await isFilterable())) {
    console.error('❌ Still not filterable after alter — investigate.');
    process.exit(1);
  }
  const [withFee, condoBand] = await Promise.all([
    countFilter(`${FIELD}:>=1`),
    countFilter(`${FIELD}:>=300 && ${FIELD}:<=900`),
  ]);
  console.log(`\n✅ ${FIELD} is now filterable.`);
  console.log(`   docs with ${FIELD} >= 1:        ${withFee.toLocaleString()}`);
  console.log(`   docs with ${FIELD} $300–$900:   ${condoBand.toLocaleString()}`);
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
