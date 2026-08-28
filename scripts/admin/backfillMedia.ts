/**
 * One-time backfill of photo media across active + sold inventory.
 *
 * Why: AMPRE's /Property endpoint does NOT return media inline ($expand=Media
 * returns HTTP 400 / OData code 1109 — verified 2026-05-27). Media records
 * live in the separate /Media resource and have to be batch-fetched. The
 * nightly ingester now does this per-batch via scripts/worker/mediaEnrichment.ts,
 * but existing rows (~100k active + ~217k sold) still have no `media` key in
 * full_payload / raw_payload. Without media the UI shows the text-only
 * "NO MEDIA" ListingThumbnail fallback for every card.
 *
 * Design (mirrors scripts/admin/backfill-listing-rooms.ts):
 * - pg + DATABASE_URL (Session pooler — direct host is IPv6-only here per
 *   CLAUDE.md §12). Standard `connectionString` + `SET statement_timeout TO '0'`.
 * - Active path: keyset-paginate `listings` filtered on the indexed-friendly
 *   `media_urls` column (no JSONB detoast on the read — only when WHERE'd at
 *   UPDATE time, by PK).
 * - Sold path: keyset-paginate `raw_vow_sold` by PK only (it has no separate
 *   media column, so the read can't pre-filter without detoasting raw_payload
 *   across 217k rows — see memory supabase-io-budget). The UPDATE WHERE clause
 *   `NOT (raw_payload ? 'media')` filters at write time per-row by PK (cheap).
 * - Patch in place via jsonb_set so the UPDATE never round-trips the whole
 *   payload.
 * - Idempotent: rows whose /Media returns empty still get `media: []` so the
 *   key exists and re-runs cost nothing extra at write time. Stale `media: []`
 *   IS re-eligible for write so AMPRE photo availability changes between runs
 *   propagate (the prior `NOT (? 'media')` guard alone stuck listings forever
 *   when their photos appeared after the first pass; now we re-write on empty).
 * - Typesense partial update: after a successful Postgres write, push
 *   `primaryImageUrl` to the matching Typesense doc (`properties` for active,
 *   `sold_listings` for sold-and-in-window). Partial updates fail-soft when
 *   the doc doesn't exist (listing not in active index, or sold listing
 *   outside the 180-day rolling window).
 *
 * Compliance:
 * - §4: deterministic — media records stored verbatim, no LLM.
 * - §6.3(c): mediaEnrichment.ts already locks the server-side query to
 *   ImageSizeDescription='Medium' (watermark URL-baked); never fetches
 *   LargestNoWatermark.
 * - §6.3(h): no 1-year cache flagged — media URLs themselves are static per
 *   the `cb:` segment, but unchanged listings are refreshed by the daily
 *   nightly sync anyway.
 * - §12: raw_vow_sold is patched in place (jsonb_set), not rebuilt; mirrors
 *   the soldIndexer's incremental write path. We only ADD the `media` key —
 *   never modify any existing field.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/admin/backfillMedia.ts                # dry-run, both
 *   npx tsx --env-file=.env.local scripts/admin/backfillMedia.ts --target active --limit 100      # dry-run
 *   npx tsx --env-file=.env.local scripts/admin/backfillMedia.ts --apply --target active --limit 100  # write 100
 *   npx tsx --env-file=.env.local scripts/admin/backfillMedia.ts --apply --target both             # full run
 *   npx tsx --env-file=.env.local scripts/admin/backfillMedia.ts --apply --target sold --start-key W12345678
 *   npx tsx --env-file=.env.local scripts/admin/backfillMedia.ts --apply --target both --keys W123,X456  # just these
 *
 * Env: DATABASE_URL (Session pooler conn string), PROPTX_IDX_TOKEN,
 *      PROPTX_VOW_TOKEN, TYPESENSE_ADMIN_API_KEY.
 *
 * After: the next daily sync naturally re-syncs any modified listings; this
 * script is a one-shot catch-up for existing rows.
 */

import { Client as PgClient } from 'pg';
import dotenv from 'dotenv';
import Typesense, { Client as TsClient } from 'typesense';
import {
  fetchMediaForKeys,
  MEDIA_REQUEST_DELAY_MS,
  type StoredMedia,
} from '../worker/mediaEnrichment';
import { selectPrimaryImage, collectMediaUrls } from '../../src/lib/etl/selectPrimaryImage';
import { photosFromRawMedia } from '../worker/ingester';

dotenv.config({ path: ['.env.local', '.env'] });

// ── Required env ─────────────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set (use the Supabase Session pooler string).');
  process.exit(1);
}
const IDX_TOKEN = (process.env.PROPTX_IDX_TOKEN || '').trim();
const VOW_TOKEN = (process.env.PROPTX_VOW_TOKEN || '').trim();
const TYPESENSE_KEY = process.env.TYPESENSE_ADMIN_API_KEY;

// ── CLI args ─────────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx < process.argv.length - 1) return process.argv[idx + 1];
  const eq = process.argv.find((a) => a.startsWith(name + '='));
  return eq?.split('=', 2)[1];
}
const APPLY = process.argv.includes('--apply');
const TARGET = (arg('--target') || 'both').toLowerCase() as 'active' | 'sold' | 'both';
if (!['active', 'sold', 'both'].includes(TARGET)) {
  console.error(`❌ --target must be one of: active|sold|both (got "${TARGET}")`);
  process.exit(1);
}
const ROW_LIMIT = Number(arg('--limit') ?? Infinity);
const START_KEY = arg('--start-key') ?? '';
/**
 * Restrict the run to an explicit comma-separated ListingKey list.
 *
 * Both sweeps already filter the READ down to rows that are actually missing media, so a
 * full run is correct — it is just enormous. When the remainder is a handful of stragglers
 * the scan is all cost and no yield: on 2026-08-27 exactly 6 pages in the whole book were
 * both photo-less AND had photos still available upstream, and reaching them meant paging
 * the entire sold table. This makes that surgical.
 *
 * It NARROWS, never widens: the missing-media predicates still apply, so naming a key that
 * already has photos is a no-op rather than a re-fetch.
 */
const ONLY_KEYS = (arg('--keys') ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
const SKIP_TYPESENSE = process.argv.includes('--skip-typesense');

// ── Token guards (target-aware so partial-target runs don't require both) ────
if ((TARGET === 'active' || TARGET === 'both') && !IDX_TOKEN) {
  console.error('❌ PROPTX_IDX_TOKEN not set (required for active /Media fetch).');
  process.exit(1);
}
if ((TARGET === 'sold' || TARGET === 'both') && !VOW_TOKEN) {
  console.error('❌ PROPTX_VOW_TOKEN not set (required for sold /Media fetch).');
  process.exit(1);
}
if (APPLY && !SKIP_TYPESENSE && !TYPESENSE_KEY) {
  console.error('❌ TYPESENSE_ADMIN_API_KEY not set. Re-run with --skip-typesense to only patch Postgres.');
  process.exit(1);
}

// ── Tuning ───────────────────────────────────────────────────────────────────
const PAGE_SIZE = 100;                                // listing keys per DB read page (chunked to 25 inside fetchMediaForKeys)
const INTER_PAGE_DELAY_MS = MEDIA_REQUEST_DELAY_MS;   // polite pacing between pages
const MAX_UPDATE_RETRIES = 5;
const SOLD_WINDOW_MS = 180 * 86_400_000;              // matches scripts/worker/soldIndexer.ts SOLD_WINDOW_DAYS

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const ACTIVE_COLLECTION = 'properties';
const SOLD_COLLECTION = 'sold_listings';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function tsClient(): TsClient | null {
  if (!APPLY || SKIP_TYPESENSE || !TYPESENSE_KEY) return null;
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
    apiKey: TYPESENSE_KEY,
    connectionTimeoutSeconds: 15,
  });
}

// ─── Active path ─────────────────────────────────────────────────────────────

/**
 * Active read: keyset-paginate by listing_key, filter on the small TEXT[]
 * `media_urls` column. Unlike `NOT (full_payload ? 'media')`, this does NOT
 * detoast JSONB across ~100k rows so it doesn't blow the Disk IO budget
 * (memory: supabase-io-budget).
 */
async function readActivePage(pg: PgClient, cursor: string, pageSize: number): Promise<string[]> {
  const keyFilter = ONLY_KEYS.length ? 'AND listing_key = ANY($3::text[])' : '';
  const sql = `
    SELECT listing_key
      FROM listings
     WHERE (media_urls IS NULL OR cardinality(media_urls) = 0)
       AND listing_key > $1
       ${keyFilter}
     ORDER BY listing_key
     LIMIT $2`;
  const params: unknown[] = ONLY_KEYS.length ? [cursor, pageSize, ONLY_KEYS] : [cursor, pageSize];
  const res = await pg.query<{ listing_key: string }>(sql, params);
  return res.rows.map((r) => r.listing_key);
}

async function updateActiveListing(
  pg: PgClient,
  listingKey: string,
  media: StoredMedia[]
): Promise<{ written: boolean; skipped: boolean }> {
  // Patches media_urls ONLY. full_payload.media is no longer stored (migration 103);
  // writing it back here would silently re-inflate the exact thing that migration
  // removed, at ~20 KB/row. media_urls is what every render path reads.
  //
  // Guard keeps the original intent: re-write when the row has NO photos, or an EMPTY
  // array (the stale-empty sentinel a prior run leaves when AMPRE returned no records),
  // so listings whose photos appear later are still picked up. Rows with real photos
  // stay protected from clobbering.
  const sql = `
    UPDATE listings
       SET media_urls = $1::text[]
     WHERE listing_key = $2
       AND (media_urls IS NULL OR cardinality(media_urls) = 0)`;
  const mediaUrls = collectMediaUrls({ media });

  let attempt = 0;
  for (;;) {
    try {
      const res = await pg.query(sql, [mediaUrls, listingKey]);
      return { written: (res.rowCount ?? 0) > 0, skipped: (res.rowCount ?? 0) === 0 };
    } catch (err: unknown) {
      attempt++;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt > MAX_UPDATE_RETRIES) {
        console.warn(`   ⚠️  UPDATE failed for ${listingKey} after ${MAX_UPDATE_RETRIES} retries: ${msg}`);
        return { written: false, skipped: false };
      }
      const backoff = Math.min(15000, 1000 * 2 ** (attempt - 1));
      console.warn(`   ⏳ UPDATE retry ${attempt}/${MAX_UPDATE_RETRIES} for ${listingKey}: ${msg}`);
      await sleep(backoff);
    }
  }
}

/** Push primaryImageUrl into Typesense `properties` via partial update. */
async function patchTypesenseActive(ts: TsClient, listingKey: string, primaryUrl: string): Promise<boolean> {
  try {
    await ts.collections(ACTIVE_COLLECTION).documents(listingKey).update({ primaryImageUrl: primaryUrl });
    return true;
  } catch (err: any) {
    if (err?.httpStatus === 404) return false; // listing not in active index — ignore
    console.warn(`   ⚠️  Typesense active update failed for ${listingKey}: ${err?.message || err}`);
    return false;
  }
}

async function backfillActive(pg: PgClient, ts: TsClient | null): Promise<void> {
  console.log('\n══════════════════════════════════════════');
  console.log('  Active backfill (listings)');
  console.log('══════════════════════════════════════════');

  let cursor = START_KEY;
  let scanned = 0, withMedia = 0, emptyMarked = 0, failedFetch = 0;
  let updated = 0, skipped = 0, failed = 0, tsUpdated = 0, tsMissed = 0;

  while (scanned < ROW_LIMIT) {
    const pageSize = Math.min(PAGE_SIZE, ROW_LIMIT - scanned);
    const keys = await readActivePage(pg, cursor, pageSize);
    if (keys.length === 0) {
      console.log('   ✅ No more active listings need media.');
      break;
    }

    const { media: mediaMap, failedKeys } = await fetchMediaForKeys(keys, IDX_TOKEN);

    for (const key of keys) {
      scanned++;
      cursor = key;
      // Fetch failed (≠ confirmed 0 photos) — skip the write so the row stays
      // eligible for the next run instead of being stamped a false empty.
      if (failedKeys.has(key)) { failedFetch++; continue; }
      const media = mediaMap.get(key) ?? [];
      if (media.length > 0) withMedia++;
      else emptyMarked++;

      if (!APPLY) continue;

      const { written, skipped: wasSkipped } = await updateActiveListing(pg, key, media);
      if (written) updated++;
      else if (wasSkipped) skipped++;
      else failed++;

      if (written && media.length > 0 && ts) {
        const primaryUrl = selectPrimaryImage({ media });
        if (primaryUrl) {
          const ok = await patchTypesenseActive(ts, key, primaryUrl);
          if (ok) tsUpdated++;
          else tsMissed++;
        }
      }
    }

    console.log(
      `   …active page  scanned=${scanned}  withMedia=${withMedia}  emptyMarked=${emptyMarked}  fetchFailed=${failedFetch}` +
        (APPLY ? `  written=${updated}  skipped=${skipped}  failed=${failed}  tsUpdated=${tsUpdated}  tsMissed=${tsMissed}` : '') +
        `  lastKey=${cursor}`
    );

    if (keys.length < pageSize) {
      console.log('   ✅ Last page.');
      break;
    }
    await sleep(INTER_PAGE_DELAY_MS);
  }

  console.log('\n──────── Active summary ────────');
  console.log(`  Scanned:       ${scanned}`);
  console.log(`  With media:    ${withMedia}`);
  console.log(`  Empty marked:  ${emptyMarked}`);
  console.log(`  Fetch failed:  ${failedFetch}  (left eligible — re-run to retry)`);
  if (APPLY) {
    console.log(`  Updated:       ${updated}`);
    console.log(`  Skipped:       ${skipped}`);
    console.log(`  Failed:        ${failed}`);
    console.log(`  Typesense set: ${tsUpdated}`);
    console.log(`  Typesense miss:${tsMissed}  (listing not in active index)`);
  }
  if (cursor && scanned >= ROW_LIMIT) {
    console.log(`  ↺ To resume:   --target active --start-key ${cursor}`);
  }
}

// ─── Sold path ───────────────────────────────────────────────────────────────

/**
 * Sold read: keyset-paginate by PK, skipping rows that already have photos.
 *
 * That filter USED to be impossible. The only tell was `raw_payload ? 'media'`, and
 * detoasting ~50 KB of JSONB across 217k rows blew the Disk IO budget — so the scan read
 * everything and leaned on the UPDATE to no-op. Migration 101 changed the shape: `photos`
 * is a separate ~3 KB column, so the same question costs a fraction of the IO and can be
 * asked on the READ instead.
 *
 * It matters because the FETCH, not the write, is the expensive half. Unfiltered, a full
 * run issues an AMPRE /Media request for all 288,963 rows in order to write ~30k of them.
 *
 * The predicate matches updateSoldListing's guard exactly, so behaviour is unchanged —
 * including that an EMPTY `photos` stays eligible, which is what lets a listing whose
 * photos only appear on AMPRE later get picked up by a re-run.
 *
 * Project `purchase_contract_date` so we can decide whether the row is inside
 * the Typesense `sold_listings` 180-day window before issuing a partial
 * update; outside-window rows still get their Postgres row patched (the AVM
 * archive is the source of truth) but skip the Typesense write.
 */
async function readSoldPage(pg: PgClient, cursor: string, pageSize: number): Promise<Array<{ listing_key: string; pcd_ms: number | null }>> {
  const keyFilter = ONLY_KEYS.length ? 'AND listing_key = ANY($3::text[])' : '';
  const sql = `
    SELECT listing_key, purchase_contract_date
      FROM raw_vow_sold
     WHERE listing_key > $1
       AND (photos IS NULL OR jsonb_array_length(photos) = 0)
       ${keyFilter}
     ORDER BY listing_key
     LIMIT $2`;
  const params: unknown[] = ONLY_KEYS.length ? [cursor, pageSize, ONLY_KEYS] : [cursor, pageSize];
  const res = await pg.query<{ listing_key: string; purchase_contract_date: string | null }>(sql, params);
  return res.rows.map((r) => {
    const ms = r.purchase_contract_date ? new Date(r.purchase_contract_date).getTime() : NaN;
    return { listing_key: r.listing_key, pcd_ms: Number.isFinite(ms) ? ms : null };
  });
}

async function updateSoldListing(
  pg: PgClient,
  listingKey: string,
  media: StoredMedia[]
): Promise<{ written: boolean; skipped: boolean }> {
  // Patches the `photos` column (migration 101), not raw_payload.media — migration 102
  // removed that key, and re-adding it here would undo the strip one row at a time.
  // photosFromRawMedia applies the same Deleted-filter / de-dupe / Order rules the
  // nightly ingester and the SQL backfill use, so all three stay in agreement.
  // Same stale-empty handling as the active path: re-write on NULL or [].
  const sql = `
    UPDATE raw_vow_sold
       SET photos = $1::jsonb
     WHERE listing_key = $2
       AND (photos IS NULL OR jsonb_array_length(photos) = 0)`;
  const mediaJson = JSON.stringify(photosFromRawMedia({ media }));

  let attempt = 0;
  for (;;) {
    try {
      const res = await pg.query(sql, [mediaJson, listingKey]);
      return { written: (res.rowCount ?? 0) > 0, skipped: (res.rowCount ?? 0) === 0 };
    } catch (err: unknown) {
      attempt++;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt > MAX_UPDATE_RETRIES) {
        console.warn(`   ⚠️  UPDATE failed for ${listingKey} after ${MAX_UPDATE_RETRIES} retries: ${msg}`);
        return { written: false, skipped: false };
      }
      const backoff = Math.min(15000, 1000 * 2 ** (attempt - 1));
      console.warn(`   ⏳ UPDATE retry ${attempt}/${MAX_UPDATE_RETRIES} for ${listingKey}: ${msg}`);
      await sleep(backoff);
    }
  }
}

async function patchTypesenseSold(ts: TsClient, listingKey: string, primaryUrl: string): Promise<boolean> {
  try {
    await ts.collections(SOLD_COLLECTION).documents(listingKey).update({ primaryImageUrl: primaryUrl });
    return true;
  } catch (err: any) {
    if (err?.httpStatus === 404) return false; // outside the window or not yet seeded
    console.warn(`   ⚠️  Typesense sold update failed for ${listingKey}: ${err?.message || err}`);
    return false;
  }
}

async function backfillSold(pg: PgClient, ts: TsClient | null): Promise<void> {
  console.log('\n══════════════════════════════════════════');
  console.log('  Sold backfill (raw_vow_sold)');
  console.log('══════════════════════════════════════════');

  const windowCutoff = Date.now() - SOLD_WINDOW_MS;
  let cursor = START_KEY;
  let scanned = 0, withMedia = 0, emptyMarked = 0, failedFetch = 0;
  let updated = 0, skipped = 0, failed = 0, tsUpdated = 0, tsMissed = 0, tsOutsideWindow = 0;

  while (scanned < ROW_LIMIT) {
    const pageSize = Math.min(PAGE_SIZE, ROW_LIMIT - scanned);
    const rows = await readSoldPage(pg, cursor, pageSize);
    if (rows.length === 0) {
      console.log('   ✅ Reached end of raw_vow_sold.');
      break;
    }

    const keys = rows.map((r) => r.listing_key);
    const { media: mediaMap, failedKeys } = await fetchMediaForKeys(keys, VOW_TOKEN);

    for (const row of rows) {
      const key = row.listing_key;
      scanned++;
      cursor = key;
      // Fetch failed (≠ confirmed 0 photos) — skip so the row stays eligible.
      if (failedKeys.has(key)) { failedFetch++; continue; }
      const media = mediaMap.get(key) ?? [];
      if (media.length > 0) withMedia++;
      else emptyMarked++;

      if (!APPLY) continue;

      const { written, skipped: wasSkipped } = await updateSoldListing(pg, key, media);
      if (written) updated++;
      else if (wasSkipped) skipped++;
      else failed++;

      if (written && media.length > 0 && ts) {
        if (row.pcd_ms === null || row.pcd_ms < windowCutoff) {
          tsOutsideWindow++;
        } else {
          const primaryUrl = selectPrimaryImage({ media });
          if (primaryUrl) {
            const ok = await patchTypesenseSold(ts, key, primaryUrl);
            if (ok) tsUpdated++;
            else tsMissed++;
          }
        }
      }
    }

    console.log(
      `   …sold page  scanned=${scanned}  withMedia=${withMedia}  emptyMarked=${emptyMarked}  fetchFailed=${failedFetch}` +
        (APPLY ? `  written=${updated}  skipped=${skipped}  failed=${failed}  tsUpdated=${tsUpdated}  tsOutside=${tsOutsideWindow}` : '') +
        `  lastKey=${cursor}`
    );

    if (rows.length < pageSize) {
      console.log('   ✅ Last page.');
      break;
    }
    await sleep(INTER_PAGE_DELAY_MS);
  }

  console.log('\n──────── Sold summary ────────');
  console.log(`  Scanned:           ${scanned}`);
  console.log(`  With media:        ${withMedia}`);
  console.log(`  Empty marked:      ${emptyMarked}`);
  console.log(`  Fetch failed:      ${failedFetch}  (left eligible — re-run to retry)`);
  if (APPLY) {
    console.log(`  Updated:           ${updated}`);
    console.log(`  Skipped:           ${skipped}`);
    console.log(`  Failed:            ${failed}`);
    console.log(`  Typesense set:     ${tsUpdated}`);
    console.log(`  Typesense missing: ${tsMissed}  (in-window but doc not found)`);
    console.log(`  Outside window:    ${tsOutsideWindow}  (PG patched, no TS write)`);
  }
  if (cursor && scanned >= ROW_LIMIT) {
    console.log(`  ↺ To resume:       --target sold --start-key ${cursor}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('============================================');
  console.log('  Media backfill ← /Media (Path B)');
  console.log(`  Mode:   ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  console.log(`  Target: ${TARGET}`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`  Limit:  ${ROW_LIMIT} rows per target`);
  if (START_KEY) console.log(`  Start:  ${START_KEY}`);
  if (SKIP_TYPESENSE) console.log('  Typesense: SKIPPED');
  console.log('============================================');

  const pg = new PgClient({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });
  await pg.connect();
  console.log('\n   ✅ Connected to PostgreSQL');
  await pg.query("SET statement_timeout TO '0'");

  const ts = tsClient();
  if (ts) console.log('   ✅ Typesense admin client ready');

  try {
    if (TARGET === 'active' || TARGET === 'both') {
      await backfillActive(pg, ts);
    }
    if (TARGET === 'sold' || TARGET === 'both') {
      await backfillSold(pg, ts);
    }
    if (!APPLY) {
      console.log('\n(DRY-RUN — no writes. Re-run with --apply to persist.)');
    }
  } finally {
    await pg.end();
    console.log('\n🔌 Connection closed.');
  }
}

main().catch((e: unknown) => {
  console.error('CRASH:', e instanceof Error ? e.message : e);
  process.exit(1);
});
