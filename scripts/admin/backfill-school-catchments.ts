/**
 * Backfill SchoolCatchments onto existing `properties` documents.
 *
 * Every document predates the field, so until this runs the boundary filter matches
 * nothing and buildSchoolFilterClause's catchment branch returns an empty list for every
 * school. The daily sync fills the field for listings it re-transforms; this fills the rest.
 *
 * PARTIAL UPDATE, NOT A REINDEX. It exports id + location, computes membership locally, and
 * patches ONLY the new field back with `import(action:'update')`. A reindex-from-vault pass
 * would rebuild whole documents and has no media source, so it silently strips photos — see
 * the reindex notes. Nothing here touches any other field.
 *
 * Reads Supabase ONCE, for the 3,296 boundary rows — not per listing. Bulk per-listing
 * Supabase reads exhaust the instance IO budget, which is why the sibling
 * backfill-school-fields.ts avoids Supabase entirely; a single 10-second load of a small
 * table is a different thing.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/admin/backfill-school-catchments.ts           # dry-run
 *   npx tsx --env-file=.env scripts/admin/backfill-school-catchments.ts --apply   # write
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import 'dotenv/config';
import Typesense from 'typesense';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';
import { fetchCatchmentZones } from '@/lib/schools/catchmentSource';
import {
  buildCatchmentIndex,
  catchmentTokensFor,
} from '@/lib/schools/catchmentMembership';
import { MIN_CATCHMENT_ZONES } from '@/lib/schools/catchmentIndex';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const FIELD = 'SchoolCatchments';
const CHUNK = 2000;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: process.env.TYPESENSE_ADMIN_API_KEY || '',
  connectionTimeoutSeconds: 180,
});

/** Add the field to the live collection if it is not there yet. Optional, so existing
 *  documents stay valid with it absent. */
async function alterCollection(): Promise<void> {
  const coll = (await ts.collections(COLLECTION).retrieve()) as { fields?: Array<{ name: string }> };
  if ((coll.fields ?? []).some((f) => f.name === FIELD)) {
    console.log(`✅ ${COLLECTION} already has ${FIELD}.`);
    return;
  }
  const def = (typesenseSchema.fields as Array<{ name: string }>).find((f) => f.name === FIELD);
  if (!def) throw new Error(`${FIELD} is missing from typesenseSchema — nothing to add.`);
  console.log(`Adding field ${FIELD} to ${COLLECTION}…`);
  if (!APPLY) {
    console.log('   (dry-run — skipping alter)');
    return;
  }
  await ts.collections(COLLECTION).update({ fields: [def] } as never);
  console.log('   done.');
}

async function main(): Promise<void> {
  console.log(`\n🏫 SchoolCatchments backfill — ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  // ── Boundaries ────────────────────────────────────────────────────────────
  const t0 = Date.now();
  const loaded = await fetchCatchmentZones(getServiceRoleClient());
  console.log(
    `   zones: ${loaded.zones.length} from ${loaded.rows} rows ` +
      `(${loaded.withoutSchoolId} without a school id, ${loaded.unreadableGeometry} unreadable) ` +
      `in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  // Same floor the ETL applies. A short read here would write `[]` onto documents that may
  // already hold a correct value, which is worse than not running at all.
  if (loaded.zones.length < MIN_CATCHMENT_ZONES) {
    throw new Error(
      `only ${loaded.zones.length} zones (floor ${MIN_CATCHMENT_ZONES}) — refusing to backfill.`
    );
  }
  const index = buildCatchmentIndex(loaded.zones);
  console.log(`   index: ${index.zones.length} zones across ${index.cells.size} cells`);

  await alterCollection();

  // ── Documents ─────────────────────────────────────────────────────────────
  console.log(`\n   exporting ${COLLECTION} (id + location)…`);
  const raw = (await ts
    .collections(COLLECTION)
    .documents()
    .export({ include_fields: 'id,location' })) as string;
  const docs = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: string; location?: [number, number] });
  console.log(`   ${docs.length} documents`);

  let withCoords = 0;
  let matched = 0;
  const patches: string[] = [];
  const histogram = new Map<number, number>();
  for (const d of docs) {
    const loc = Array.isArray(d.location) ? d.location : null;
    const tokens = loc ? catchmentTokensFor(loc[0], loc[1], index) : [];
    if (loc) withCoords++;
    if (tokens.length) matched++;
    histogram.set(tokens.length, (histogram.get(tokens.length) ?? 0) + 1);
    patches.push(JSON.stringify({ id: d.id, [FIELD]: tokens }));
  }

  console.log(`\n   with coordinates : ${withCoords} / ${docs.length}`);
  console.log(`   in ≥1 catchment  : ${matched} (${((100 * matched) / Math.max(docs.length, 1)).toFixed(1)}%)`);
  console.log('   catchments per listing:');
  for (const n of [...histogram.keys()].sort((a, b) => a - b).slice(0, 12)) {
    console.log(`     ${String(n).padStart(2)} → ${histogram.get(n)}`);
  }

  // A listing with coordinates that lands in no catchment at all is possible — plenty of
  // Ontario is outside every board that publishes — but if that is most of them, the load
  // or the geometry is wrong and writing it would be worse than stopping.
  if (withCoords > 0 && matched / withCoords < 0.5) {
    throw new Error(
      `only ${((100 * matched) / withCoords).toFixed(1)}% of geocoded listings matched a ` +
        `catchment — that is too low to publish. Check the boundary load before applying.`
    );
  }

  if (!APPLY) {
    console.log('\n   (dry-run — nothing written). Re-run with --apply.');
    return;
  }

  console.log(`\n   patching ${patches.length} documents in chunks of ${CHUNK}…`);
  let written = 0;
  let failed = 0;
  for (let i = 0; i < patches.length; i += CHUNK) {
    const batch = patches.slice(i, i + CHUNK);
    const res = (await ts
      .collections(COLLECTION)
      .documents()
      .import(batch.join('\n'), { action: 'update' })) as string;
    for (const line of res.split('\n')) {
      if (!line) continue;
      if (line.includes('"success":true')) written++;
      else {
        failed++;
        if (failed <= 5) console.error(`     ! ${line.slice(0, 200)}`);
      }
    }
    console.log(`     ${Math.min(i + CHUNK, patches.length)} / ${patches.length}`);
  }

  console.log(`\n✅ written ${written}, failed ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('\n❌', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
