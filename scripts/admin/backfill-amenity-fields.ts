/**
 * Shadow MLS — Backfill amenity-proximity fields into existing Typesense docs.
 *
 * Phase 2 of the amenity-proximity feature. Existing `properties` docs predate the
 * grocery/recreation distance fields, so this script:
 *   1. ALTERs the live collection to add any missing amenity fields (optional, so existing
 *      docs stay valid).
 *   2. EXPORTs every doc's id + location, recomputes the nearest grocery + recreation
 *      centre locally from data/gta-amenities.json (via assignAmenities — deterministic,
 *      §4/§6), and patches the new fields back with import(action:'update').
 *
 * Reads ONLY Typesense + the local amenities JSON — NO Supabase. (Bulk Supabase reads
 * exhaust the instance IO budget; see backfill-school-fields.ts.)
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-amenity-fields.ts           # dry-run
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-amenity-fields.ts --apply   # write
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import Typesense from 'typesense';
import { assignAmenities, NO_AMENITY_KM } from '@/lib/amenities/nearestAmenities';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_COLLECTION = 'properties';
const TYPESENSE_KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const CHUNK = 2000;

// Indexed amenity fields (must match typesenseSchema) — used to ALTER the collection.
// The per-doc patch also carries the *Name cargo, which Typesense stores without an
// explicit field declaration (mirrors the school name cargo).
const AMENITY_FIELDS = ['NearestGroceryKm', 'NearestRecCentreKm'] as const;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: TYPESENSE_KEY,
  connectionTimeoutSeconds: 120,
});

async function alterCollection() {
  const coll: any = await ts.collections(TYPESENSE_COLLECTION).retrieve();
  const existing = new Set<string>((coll.fields || []).map((f: any) => f.name));
  const toAdd = (typesenseSchema.fields as any[]).filter(
    (f) => (AMENITY_FIELDS as readonly string[]).includes(f.name) && !existing.has(f.name)
  );
  if (toAdd.length === 0) {
    console.log('✅ Collection already has all amenity fields — no alter needed.');
    return;
  }
  console.log(`Adding ${toAdd.length} fields: ${toAdd.map((f) => f.name).join(', ')}`);
  if (!APPLY) {
    console.log('   (dry-run — skipping alter)');
    return;
  }
  await ts.collections(TYPESENSE_COLLECTION).update({ fields: toAdd } as any);
  console.log('   ✅ Collection altered.');
}

async function main() {
  console.log(`\n🛒 Backfill Amenity Fields  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!TYPESENSE_KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }

  await alterCollection();

  console.log('\nExporting id + location for all docs...');
  const raw = (await ts
    .collections(TYPESENSE_COLLECTION)
    .documents()
    .export({ include_fields: 'id,location' })) as unknown as string;
  const lines = raw.split('\n').filter((l) => l.trim());
  console.log(`Exported ${lines.length.toLocaleString()} docs.`);

  const updates: Record<string, unknown>[] = [];
  let noLoc = 0;
  let withGrocery = 0;
  for (const line of lines) {
    const doc = JSON.parse(line) as { id: string; location?: [number, number] };
    const loc = doc.location;
    if (!loc || loc.length !== 2) {
      noLoc++;
      continue;
    }
    const a = assignAmenities(loc);
    if (a.NearestGroceryKm < NO_AMENITY_KM) withGrocery++;
    updates.push({ id: doc.id, ...a });
  }
  console.log(
    `Computed ${updates.length.toLocaleString()} patches (${withGrocery.toLocaleString()} with a grocery in range, ${noLoc} skipped for missing location).`
  );

  if (!APPLY) {
    console.log('\nSample patch:', JSON.stringify(updates[0], null, 2)?.slice(0, 400));
    console.log(`\n💡 Dry-run. Re-run with --apply to patch ${updates.length.toLocaleString()} docs.`);
    return;
  }

  console.log(`\n🔄 Patching ${updates.length.toLocaleString()} docs in chunks of ${CHUNK}...`);
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const res: any = await ts.collections(TYPESENSE_COLLECTION).documents().import(chunk, { action: 'update' });
    const arr = Array.isArray(res) ? res : [];
    const chunkOk = arr.filter((x: any) => x.success).length;
    ok += chunkOk;
    failed += chunk.length - chunkOk;
    const firstErr = arr.find((x: any) => !x.success);
    console.log(`   [${i + chunk.length}/${updates.length}] +${chunkOk} ok${firstErr ? `  (e.g. ${firstErr.error})` : ''}`);
  }
  console.log(`\n✅ Done. Updated ${ok.toLocaleString()} docs, ${failed} failed.`);
}

main().catch((e) => {
  console.error('\n❌ Crashed:', e?.message || e);
  process.exit(1);
});
