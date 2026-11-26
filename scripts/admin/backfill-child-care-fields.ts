/**
 * Shadow MLS — Backfill licensed child care distance fields into existing Typesense docs.
 *
 * Existing `properties` docs predate NearestChildCareKm / NearestInfantCareKm /
 * NearestCwelccKm, so this script:
 *   1. ALTERs the live collection to add any missing child care fields (PATCH
 *      /collections/properties — additive, optional, no reindex; same mechanism as
 *      backfill-amenity-fields.ts and add-typesense-field.ts). The definitions come from
 *      typesenseSchema.ts so the code and the collection cannot disagree.
 *   2. EXPORTs every doc's id + location, keeps every doc WITH a location inside the
 *      Ontario bounding box, recomputes the 3 distances locally from
 *      data/toronto-child-care.json + data/ontario-child-care.json (assignChildCare —
 *      deterministic, §4/§6), and patches them back with import(action:'update').
 *      Toronto-box docs are recomputed too: a home near the city line now also sees the
 *      Ontario centres across it. Docs without a location, or outside Ontario, are NOT
 *      touched (their fields stay missing, which a `<=X` filter never matches).
 *
 * PARTIAL UPDATE, NOT A REINDEX: only the 3 fields are sent, nothing else on a doc moves.
 * GENTLE ON THE CLUSTER: small batches (default 200) with a pause between them (default
 * 1000 ms) because the Typesense cluster CPU runs near its limit. A failed batch is retried
 * once after a longer pause.
 *
 * Reads ONLY Typesense + the local JSON — NO Supabase.
 *
 * Usage (dry-run is the default; nothing is written without --apply):
 *   npx tsx --env-file=.env scripts/admin/backfill-child-care-fields.ts                 # dry-run
 *   npx tsx --env-file=.env scripts/admin/backfill-child-care-fields.ts --limit=500     # dry-run, first 500
 *   npx tsx --env-file=.env scripts/admin/backfill-child-care-fields.ts --apply --limit=500
 *   npx tsx --env-file=.env scripts/admin/backfill-child-care-fields.ts --apply
 *   npx tsx --env-file=.env scripts/admin/backfill-child-care-fields.ts --verify       # read-only counts
 * Options: --batch=200  --pause-ms=1000  --limit=N  --dry-run (explicit; same as no --apply)
 * Env: TYPESENSE_ADMIN_API_KEY.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import Typesense from 'typesense';
import {
  assignChildCare,
  inOntarioBbox,
  inTorontoBbox,
  NO_CHILD_CARE_KM,
  TORONTO_BBOX,
} from '@/lib/childcare/nearestChildCare';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function intArg(name: string, fallback: number): number {
  const v = arg(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`❌ --${name} must be a non-negative integer (got "${v}")`);
    process.exit(1);
  }
  return n;
}

const VERIFY = process.argv.includes('--verify');
const APPLY = process.argv.includes('--apply') && !process.argv.includes('--dry-run') && !VERIFY;
const BATCH = Math.max(1, intArg('batch', 200));
const PAUSE_MS = intArg('pause-ms', 1000);
const LIMIT = intArg('limit', 0); // 0 = all Ontario docs with a location

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const TYPESENSE_KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';

const CHILD_CARE_FIELDS = ['NearestChildCareKm', 'NearestInfantCareKm', 'NearestCwelccKm'] as const;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: TYPESENSE_KEY,
  connectionTimeoutSeconds: 120,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function alterCollection(): Promise<void> {
  const coll = (await ts.collections(COLLECTION).retrieve()) as { fields?: Array<{ name: string }> };
  const existing = new Set((coll.fields ?? []).map((f) => f.name));
  const toAdd = (typesenseSchema.fields as Array<{ name: string }>).filter(
    (f) => (CHILD_CARE_FIELDS as readonly string[]).includes(f.name) && !existing.has(f.name)
  );
  const missingFromCode = CHILD_CARE_FIELDS.filter(
    (n) => !(typesenseSchema.fields as Array<{ name: string }>).some((f) => f.name === n)
  );
  if (missingFromCode.length) throw new Error(`${missingFromCode.join(', ')} missing from typesenseSchema`);
  if (toAdd.length === 0) {
    console.log('✅ Collection already has all child care fields — no alter needed.');
    return;
  }
  console.log(`Adding ${toAdd.length} fields: ${toAdd.map((f) => f.name).join(', ')}`);
  if (!APPLY) {
    console.log('   (dry-run — skipping alter)');
    return;
  }
  await ts.collections(COLLECTION).update({ fields: toAdd } as never);
  console.log('   ✅ Collection altered.');
}

interface ImportResult {
  success: boolean;
  error?: string;
}

async function importBatch(batch: Record<string, unknown>[]): Promise<ImportResult[]> {
  const res = (await ts.collections(COLLECTION).documents().import(batch, { action: 'update' })) as unknown;
  return Array.isArray(res) ? (res as ImportResult[]) : [];
}

async function count(filter?: string): Promise<number> {
  const res = (await ts
    .collections(COLLECTION)
    .documents()
    .search({ q: '*', query_by: 'UnparsedAddress', filter_by: filter, per_page: 0 } as never)) as { found: number };
  return res.found;
}

async function verify(): Promise<void> {
  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
  const b = TORONTO_BBOX;
  const box = `location:(${b.minLat}, ${b.minLng}, ${b.minLat}, ${b.maxLng}, ${b.maxLat}, ${b.maxLng}, ${b.maxLat}, ${b.minLng})`;
  // Typesense has no NOT for a geo polygon, so "outside" = all minus inside.
  const total = await count();
  const toronto = await count(box);
  const outside = total - toronto;
  console.log('\n📊 Child care backfill verification (properties collection)');
  console.log('='.repeat(64));
  console.log(`Total docs                   : ${total.toLocaleString()}`);
  console.log(`In the Toronto bounding box  : ${toronto.toLocaleString()}`);
  console.log(`Outside it                   : ${outside.toLocaleString()}`);
  for (const f of CHILD_CARE_FIELDS) {
    const withField = await count(`${f}:>=0`);
    const present = await count(`${f}:<${NO_CHILD_CARE_KM}`);
    const presentT = await count(`${f}:<${NO_CHILD_CARE_KM} && ${box}`);
    const k1 = await count(`${f}:<=1`);
    const k1T = await count(`${f}:<=1 && ${box}`);
    const k05 = await count(`${f}:<=0.5`);
    console.log(`${f} — field set on ${withField.toLocaleString()} docs (${pct(withField, total)})`);
    console.log(
      `  within 5 km : Toronto box ${presentT.toLocaleString()} (${pct(presentT, toronto)}) · ` +
        `outside ${(present - presentT).toLocaleString()} (${pct(present - presentT, outside)})`
    );
    console.log(
      `  ≤1 km       : Toronto box ${k1T.toLocaleString()} · outside ${(k1 - k1T).toLocaleString()}   ≤0.5 km (all): ${k05.toLocaleString()}`
    );
  }
  const sample = (await ts
    .collections(COLLECTION)
    .documents()
    .search({
      q: '*',
      query_by: 'UnparsedAddress',
      filter_by: `NearestChildCareKm:<${NO_CHILD_CARE_KM}`,
      include_fields: `id,UnparsedAddress,${CHILD_CARE_FIELDS.join(',')}`,
      per_page: 3,
    } as never)) as { hits?: Array<{ document: Record<string, unknown> }> };
  console.log('\nSample docs:');
  for (const h of sample.hits ?? []) {
    const d = h.document;
    console.log(
      `  ${d.UnparsedAddress ?? d.id}: any ${d.NearestChildCareKm} km | infant ${d.NearestInfantCareKm} km | $10/day ${d.NearestCwelccKm} km`
    );
  }
}

async function main(): Promise<void> {
  if (!TYPESENSE_KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }
  if (VERIFY) {
    await verify();
    return;
  }

  console.log(`\n👶 Backfill Child Care Fields  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log(`   batch ${BATCH} · pause ${PAUSE_MS} ms · limit ${LIMIT || 'none'}`);
  console.log('='.repeat(56));

  await alterCollection();

  console.log('\nExporting id + location for all docs...');
  const raw = (await ts
    .collections(COLLECTION)
    .documents()
    .export({ include_fields: 'id,location' })) as unknown as string;
  const lines = raw.split('\n').filter((l) => l.trim());
  console.log(`Exported ${lines.length.toLocaleString()} docs.`);

  const updates: Record<string, unknown>[] = [];
  let noLoc = 0;
  let outside = 0;
  let inToronto = 0;
  let withAny = 0;
  let withInfant = 0;
  for (const line of lines) {
    const doc = JSON.parse(line) as { id: string; location?: [number, number] };
    const loc = Array.isArray(doc.location) && doc.location.length === 2 ? doc.location : null;
    if (!loc) {
      noLoc++;
      continue;
    }
    if (!inOntarioBbox(loc)) {
      outside++;
      continue;
    }
    if (inTorontoBbox(loc)) inToronto++;
    const c = assignChildCare(loc);
    if (c.NearestChildCareKm < NO_CHILD_CARE_KM) withAny++;
    if (c.NearestInfantCareKm < NO_CHILD_CARE_KM) withInfant++;
    updates.push({ id: doc.id, ...c });
    if (LIMIT && updates.length >= LIMIT) break;
  }
  console.log(
    `Computed ${updates.length.toLocaleString()} patches inside the Ontario box ` +
      `(${inToronto.toLocaleString()} in the Toronto box, ${(updates.length - inToronto).toLocaleString()} outside it; ` +
      `${withAny.toLocaleString()} with a licensed centre within 5 km, ${withInfant.toLocaleString()} with infant care; ` +
      `${outside.toLocaleString()} outside Ontario and ${noLoc.toLocaleString()} without a location left untouched` +
      `${LIMIT ? `; stopped at --limit=${LIMIT}` : ''}).`
  );

  if (!APPLY) {
    console.log('\nSample patch:', JSON.stringify(updates[0] ?? null));
    const batches = Math.ceil(updates.length / BATCH);
    console.log(
      `\n💡 Dry-run. Re-run with --apply to patch ${updates.length.toLocaleString()} docs in ` +
        `${batches} batches (~${Math.round((batches * PAUSE_MS) / 60000)} min of pauses).`
    );
    return;
  }

  console.log(`\n🔄 Patching ${updates.length.toLocaleString()} docs in batches of ${BATCH}...`);
  let ok = 0;
  let failed = 0;
  const started = Date.now();
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    let res: ImportResult[] | null = null;
    try {
      res = await importBatch(batch);
    } catch (e) {
      console.warn(`   ⚠️  batch at ${i} failed (${(e as Error).message}) — retrying once in ${PAUSE_MS * 5} ms`);
      await sleep(PAUSE_MS * 5);
      try {
        res = await importBatch(batch);
      } catch (e2) {
        console.error(`   ❌ batch at ${i} failed again (${(e2 as Error).message}) — skipped`);
      }
    }
    const batchOk = res ? res.filter((x) => x.success).length : 0;
    ok += batchOk;
    failed += batch.length - batchOk;
    const firstErr = res?.find((x) => !x.success);
    const done = i + batch.length;
    if (firstErr || done === updates.length || (i / BATCH) % 10 === 0) {
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(
        `   [${done}/${updates.length}] ok ${ok} · failed ${failed} · ${secs}s${firstErr ? `  (e.g. ${firstErr.error})` : ''}`
      );
    }
    if (done < updates.length && PAUSE_MS > 0) await sleep(PAUSE_MS);
  }
  console.log(`\n✅ Done. Updated ${ok.toLocaleString()} docs, ${failed} failed.`);
  console.log('   Check with: npx tsx --env-file=.env scripts/admin/backfill-child-care-fields.ts --verify');
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\n❌ Crashed:', e?.message || e);
  process.exit(1);
});
