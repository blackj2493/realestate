/**
 * Ensure every `sold_listings` doc carries an explicit `BedroomsAboveGrade` so the
 * grade-aware beds filter (buildSoldFilter / aboveGradeBedsClause) treats every deal
 * type uniformly and never silently drops docs that lack the field.
 *
 * Two cases, both repaired idempotently (docs that already have the field are skipped):
 *
 *   • DE-LISTED (terminated/expired/suspended): the VOW de-list feed carries no
 *     below-grade split, so the indexed `BedroomsTotal` ALREADY equals the
 *     above-grade count (see delistedMapper.toDelistedDocument). Copy it across:
 *     BedroomsAboveGrade = BedroomsTotal, BedroomsBelowGrade = 0.
 *
 *   • SOLD/LEASED legacy docs (indexed before the grade fields existed): the true
 *     above-grade split is unknown and `BedroomsTotal` may be the inflated above+below.
 *     Set BedroomsAboveGrade = 0 so the filter's `(:=0 && BedroomsTotal:>=n)` fallback
 *     matches them by total — exactly how the active `properties` collection behaves.
 *
 * Typesense-only, non-destructive partial updates (no Supabase, no live VOW API). The
 * forward path is fixed in delistedMapper.ts / soldIndexer.ts so new docs carry the
 * fields natively; this just repairs the existing window.
 *
 * Usage:
 *   npx tsx scripts/admin/backfill-delisted-bedroom-grade.ts           # dry-run (counts only)
 *   npx tsx scripts/admin/backfill-delisted-bedroom-grade.ts --apply   # write the updates
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { SOLD_LISTINGS_COLLECTION } from '@/lib/typesense/soldListingsSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const DELISTED = new Set(['terminated', 'expired', 'suspended']);
const CHUNK = 500;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});

interface ExportedDoc {
  id: string;
  DealType?: string;
  BedroomsTotal?: number;
  BedroomsAboveGrade?: number;
}

async function main() {
  console.log(`\n🛏️  Ensure sold_listings BedroomsAboveGrade  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(60));
  if (!KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }

  // Pull id + DealType + the grade-relevant fields for every doc in the window.
  const raw = (await ts
    .collections(SOLD_LISTINGS_COLLECTION)
    .documents()
    .export({ include_fields: 'id,DealType,BedroomsTotal,BedroomsAboveGrade' })) as unknown as string;

  const docs: ExportedDoc[] = raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ExportedDoc);

  // Only docs that are MISSING the field need repair (idempotent re-runs).
  const missing = docs.filter((d) => typeof d.BedroomsAboveGrade !== 'number');
  const delistedMissing = missing.filter((d) => DELISTED.has(d.DealType ?? '')).length;
  console.log(
    `Total docs: ${docs.length}  |  missing BedroomsAboveGrade: ${missing.length}` +
      `  (de-listed ${delistedMissing}, sold/leased ${missing.length - delistedMissing})`
  );

  // De-listed: total IS above-grade → copy it. Sold/leased legacy: unknown → 0 (total fallback).
  const updates = missing.map((d) => {
    const isDelisted = DELISTED.has(d.DealType ?? '');
    const total = Math.max(0, Math.round(Number(d.BedroomsTotal) || 0));
    return isDelisted
      ? { id: d.id, BedroomsAboveGrade: total, BedroomsBelowGrade: 0 }
      : { id: d.id, BedroomsAboveGrade: 0 };
  });

  if (!APPLY) {
    console.log('Sample updates:', JSON.stringify(updates.slice(0, 3)));
    console.log(`\n(dry-run — re-run with --apply to write ${updates.length} partial updates)`);
    return;
  }
  if (updates.length === 0) {
    console.log('\n✅ Nothing to do — every doc already has BedroomsAboveGrade.');
    return;
  }

  let success = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const resp = await ts
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .import(chunk, { action: 'update' });
    const results = Array.isArray(resp) ? resp : JSON.parse(resp as unknown as string);
    for (const r of results) {
      if (r.success) success++;
      else {
        failed++;
        if (failed <= 5) console.warn(`   ⚠️  update error: ${r.error ?? 'unknown'}`);
      }
    }
    console.log(`   📄 ${Math.min(i + CHUNK, updates.length)}/${updates.length}  (ok ${success}, failed ${failed})`);
  }
  console.log(`\n✅ Done: ${success} updated, ${failed} failed.`);
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
