/**
 * Shadow MLS — Backfill `thumbnailUrl` (the 240px cover photo) into the live
 * `properties` index.
 *
 * WHY: the terminal ledger renders a 144x112 card from `primaryImageUrl`, which is the
 * 960x960 'Medium' variant — measured across 120 live listings at a median 155 KB, and
 * flagged by Next.js as the Largest Contentful Paint element on /properties. A 100-row
 * ledger is ~15 MB of photos for boxes that need ~1.2 MB. The size sits inside the
 * imgproxy signature, so the URL cannot be rewritten (a hand-edited `rs:fit:288:288`
 * returns 403); the small image exists only as a separate 'Thumbnail' URL, present on
 * 100% of the sampled listings at 240x160 and a median 12 KB — 92% smaller, and the
 * SAME logical photo (identical MediaObjectID on 5/5 spot-checked).
 *
 * The transformer now emits `thumbnailUrl`, but only for listings the daily sync
 * re-writes. This patches everything already in the index.
 *
 * SOURCE IS AMPRE, NOT SUPABASE — unlike the other backfills in this directory. The URL
 * has never been stored anywhere, so it has to be fetched. One bounded request per 25
 * keys (~4k requests for a full index), not a full media walk.
 *
 * PARTIAL UPDATE, NOT UPSERT: `action: 'update'` patches the one field. A plain upsert
 * would REPLACE each document and drop every field this script does not send.
 *
 * NO SCHEMA ALTER IS NEEDED. The live collection does not declare `primaryImageUrl`
 * either, yet stores and returns it on all 98k documents — Typesense keeps undeclared
 * fields. See alterCollection() below; --alter is opt-in.
 *
 * Absent stays absent. A listing whose thumb fetch fails is skipped, never written as
 * '' — every consumer reads `thumbnailUrl || primaryImageUrl`, so a missing value costs
 * bytes and never correctness. Re-run to pick up stragglers.
 *
 * IO-frugal + idempotent + resumable. DRY-RUN reads only (coverage probe).
 *   npx tsx --env-file=.env scripts/admin/backfill-thumbnail-url.ts            # dry-run
 *   npx tsx --env-file=.env scripts/admin/backfill-thumbnail-url.ts --apply    # write
 *   npx tsx --env-file=.env scripts/admin/backfill-thumbnail-url.ts --apply --resume
 *   npx tsx --env-file=.env scripts/admin/backfill-thumbnail-url.ts --pages 2   # quick probe
 *   npx tsx --env-file=.env scripts/admin/backfill-thumbnail-url.ts --apply --alter  # + declare
 */
import 'dotenv/config';
import Typesense from 'typesense';
import * as fs from 'fs';
import * as path from 'path';
import { fetchCoverThumbsForKeys } from '../worker/mediaEnrichment';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');
const ALTER = process.argv.includes('--alter');
/** `--pages N` stops after N pages. Exists so a dry run can be sanity-checked in
 *  seconds instead of walking the whole index. */
const MAX_PAGES = (() => {
  const i = process.argv.indexOf('--pages');
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

const FIELD = 'thumbnailUrl';
const COLLECTION = 'properties';
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const IDX_TOKEN = (process.env.PROPTX_IDX_TOKEN || '').trim();

/** Typesense pages at 250; AMPRE is asked in 25s inside fetchCoverThumbsForKeys. */
const PAGE_SIZE = 250;
/** Documents per Typesense import call. */
const IMPORT_CHUNK = 500;
const CURSOR_FILE = path.join(process.cwd(), 'scripts', 'admin', '.backfill-thumbnail-cursor.json');

if (!TYPESENSE_KEY) {
  console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
  process.exit(1);
}
if (!IDX_TOKEN) {
  console.error('❌ PROPTX_IDX_TOKEN not set');
  process.exit(1);
}

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: TYPESENSE_KEY,
  connectionTimeoutSeconds: 120,
});

/**
 * OPT-IN (`--alter`), and deliberately not the default.
 *
 * The live collection declares 93 fields and `primaryImageUrl` is NOT one of them — yet
 * every document carries it and every search returns it, because Typesense stores and
 * returns fields the schema never declared. `thumbnailUrl` is the same shape of value
 * (stored, never queried, never faceted), so the backfill and the daily sync can both
 * write it with no alter at all, exactly as primaryImageUrl has always been written.
 *
 * The declaration in typesenseSchema.ts still matters — it is what a freshly created
 * collection gets — but forcing it onto the live 98k-doc collection buys nothing and is
 * a schema change nobody needs to take. Pass --alter only if you want the live schema
 * to match the file.
 */
async function alterCollection() {
  const coll = (await ts.collections(COLLECTION).retrieve()) as unknown as {
    fields?: { name?: string }[];
  };
  if ((coll.fields ?? []).some((f) => f.name === FIELD)) {
    console.log(`   '${FIELD}' already declared on the collection — no alter needed.`);
    return;
  }
  if (!ALTER) {
    console.log(`   '${FIELD}' is undeclared — writing it anyway, exactly as primaryImageUrl is.`);
    console.log('   (pass --alter to add it to the live schema instead)');
    return;
  }
  const def = typesenseSchema.fields.find((f) => f.name === FIELD);
  if (!def) throw new Error(`${FIELD} is not in typesenseSchema.fields — declare it there first.`);
  console.log(`   adding field: ${JSON.stringify(def)}`);
  if (!APPLY) {
    console.log('   (dry-run — skipping alter; the patch counts below are still real)');
    return;
  }
  // The client's update() signature is a collection-schema delta; only `fields` is
  // needed here, so cast through unknown rather than restate the whole schema type.
  await ts
    .collections(COLLECTION)
    .update({ fields: [def] } as unknown as Record<string, unknown> as never);
  console.log('   ✅ collection altered');
}

interface Cursor {
  page: number;
  patched: number;
  skipped: number;
}

function readCursor(): Cursor {
  if (!RESUME) return { page: 1, patched: 0, skipped: 0 };
  try {
    return JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8')) as Cursor;
  } catch {
    return { page: 1, patched: 0, skipped: 0 };
  }
}

function writeCursor(c: Cursor) {
  if (APPLY) fs.writeFileSync(CURSOR_FILE, JSON.stringify(c), 'utf8');
}

/**
 * One page of documents that still need the field.
 *
 * Typesense cannot filter on "field is absent" for an optional string, so the page is
 * fetched whole and filtered here. `include_fields` keeps the payload to the two values
 * this script reads — the docs carry RawImages and would otherwise be ~1 MB per page.
 */
async function pageDocs(page: number): Promise<{ id: string; hasThumb: boolean }[]> {
  const res = (await ts
    .collections(COLLECTION)
    .documents()
    .search({
      q: '*',
      query_by: 'City',
      per_page: PAGE_SIZE,
      page,
      include_fields: 'id,thumbnailUrl',
    })) as unknown as { hits?: { document: { id: string; thumbnailUrl?: string } }[] };
  return (res.hits ?? []).map((h) => ({
    id: h.document.id,
    hasThumb: Boolean(h.document.thumbnailUrl),
  }));
}

async function main() {
  console.log(APPLY ? '🖼️  BACKFILL thumbnailUrl — APPLY' : '🖼️  BACKFILL thumbnailUrl — DRY RUN (no writes)');

  await alterCollection();

  const cursor = readCursor();
  if (RESUME) console.log(`   resuming at page ${cursor.page} (patched ${cursor.patched}, skipped ${cursor.skipped})`);

  let seen = 0;
  let alreadyHad = 0;
  let pending: { id: string; thumbnailUrl: string }[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    if (APPLY) {
      // action:'update' patches only the fields present in each row. An upsert here
      // would replace the whole document and delete everything else on it.
      await ts.collections(COLLECTION).documents().import(pending, { action: 'update' });
    }
    cursor.patched += pending.length;
    pending = [];
  };

  // Captured BEFORE the loop: cursor.page is advanced on every iteration, so
  // measuring progress against it would always read zero pages done.
  const startPage = cursor.page;

  for (let page = cursor.page; ; page++) {
    const docs = await pageDocs(page);
    if (docs.length === 0) break;
    seen += docs.length;

    const need = docs.filter((d) => !d.hasThumb);
    alreadyHad += docs.length - need.length;
    if (need.length > 0) {
      const thumbs = await fetchCoverThumbsForKeys(
        need.map((d) => d.id),
        IDX_TOKEN
      );
      for (const d of need) {
        const url = thumbs.get(d.id);
        if (url) pending.push({ id: d.id, thumbnailUrl: url });
        else cursor.skipped++; // no Thumbnail variant, or the chunk failed — leave absent
      }
      if (pending.length >= IMPORT_CHUNK) await flush();
    }

    cursor.page = page + 1;
    writeCursor(cursor);
    if (page % 20 === 0) {
      console.log(`   page ${page}: seen ${seen}, patched ${cursor.patched}, already had ${alreadyHad}, no-thumb ${cursor.skipped}`);
    }
    if (page - startPage + 1 >= MAX_PAGES) {
      console.log(`   stopping after ${MAX_PAGES} page(s) as asked (--pages)`);
      break;
    }
    // Typesense caps deep paging; stop before it errors and let --resume continue.
    if (page * PAGE_SIZE >= 250_000) {
      console.log('   reached the paging cap — re-run to continue past it');
      break;
    }
  }
  await flush();

  console.log('\n─────────────────────────────');
  console.log(`   documents seen : ${seen}`);
  console.log(`   already had it : ${alreadyHad}`);
  console.log(`   ${APPLY ? 'patched' : 'would patch'} : ${cursor.patched}`);
  console.log(`   no thumb found : ${cursor.skipped} (left absent → falls back to primaryImageUrl)`);
  if (!APPLY) console.log('\n   Dry run. Re-run with --apply to write.');
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
