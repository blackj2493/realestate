/**
 * Shadow MLS — Backfill School-Aware Search fields into existing Typesense docs.
 *
 * Phase 2 of school-aware listing search. Existing `properties` docs predate the school
 * fields, so this script:
 *   1. ALTERs the live collection to add any missing school fields (optional, so existing
 *      docs stay valid).
 *   2. EXPORTs every doc's id + location, recomputes nearest rated schools locally from
 *      data/ontario-schools.json (via assignSchools — deterministic, §4/§6), and patches
 *      only the new fields back with import(action:'update').
 *
 * Reads ONLY Typesense + the local schools JSON — NO Supabase. (Bulk Supabase reads
 * exhaust the instance IO budget; see memory. Do not use reindex-from-vault.ts here.)
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-school-fields.ts           # dry-run
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-school-fields.ts --apply   # write
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import Typesense from 'typesense';
import { assignSchools } from '@/lib/schools/nearestSchools';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_COLLECTION = 'properties';
const TYPESENSE_KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const CHUNK = 2000;

// School field names (source of truth = typesenseSchema). Used both to ALTER the
// collection and to assemble the per-doc patch.
const SCHOOL_FIELDS = [
  'ElemPublicScore', 'ElemPublicSchool', 'ElemPublicDistanceKm',
  'ElemCatholicScore', 'ElemCatholicSchool', 'ElemCatholicDistanceKm',
  'SecPublicScore', 'SecPublicSchool', 'SecPublicDistanceKm',
  'SecCatholicScore', 'SecCatholicSchool', 'SecCatholicDistanceKm',
  'BestElementaryScore', 'BestSecondaryScore', 'BestSchoolScoreNearby',
  'NearbySchools',
] as const;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: TYPESENSE_KEY,
  connectionTimeoutSeconds: 120,
});

async function alterCollection() {
  const coll: any = await ts.collections(TYPESENSE_COLLECTION).retrieve();
  const existing = new Set<string>((coll.fields || []).map((f: any) => f.name));
  const toAdd = (typesenseSchema.fields as any[]).filter(
    (f) => SCHOOL_FIELDS.includes(f.name) && !existing.has(f.name)
  );
  if (toAdd.length === 0) {
    console.log('✅ Collection already has all school fields — no alter needed.');
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
  console.log(`\n🏫 Backfill School Fields  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
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
  let withSchool = 0;
  for (const line of lines) {
    const doc = JSON.parse(line) as { id: string; location?: [number, number] };
    const loc = doc.location;
    if (!loc || loc.length !== 2) {
      noLoc++;
      continue;
    }
    const s = assignSchools(loc);
    if (s.BestSchoolScoreNearby > 0) withSchool++;
    updates.push({ id: doc.id, ...s });
  }
  console.log(`Computed ${updates.length.toLocaleString()} patches (${withSchool.toLocaleString()} with a rated school nearby, ${noLoc} skipped for missing location).`);

  if (!APPLY) {
    const sample = updates[0];
    console.log('\nSample patch:', JSON.stringify(sample, null, 2)?.slice(0, 600));
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
