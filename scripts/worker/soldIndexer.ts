/**
 * Sold listings → Typesense indexer.
 *
 * Maintains the bounded (rolling 180-day) `sold_listings` collection that powers the
 * dashboard Market Activity "Sold" column. Two entry points:
 *
 *  1. INCREMENTAL (called from ingester.ts Query B): each daily sold batch is mapped
 *     in-memory and upserted — no extra Postgres read. `ListOfficeName` comes straight
 *     from the raw VOW JSON (free; avoids the JSONB detoast that made the old route slow).
 *
 *  2. BACKFILL (CLI: `npx tsx scripts/worker/soldIndexer.ts backfill`): reads the
 *     180-day window from Supabase `raw_vow_sold` (lean columns + ListOfficeName
 *     extracted once) and bulk-imports — to seed the collection or recover if dropped.
 *
 * A prune step (`pruneOldSold`) drops anything older than the window so RAM stays flat.
 *
 * The full ~217k historical archive stays in `raw_vow_sold` (read-only AVM anchor,
 * CLAUDE.md §12) — this collection is a disposable, rebuildable search cache.
 */

// Must precede the supabase client import: that module reads env vars at load time.
import 'dotenv/config';
import Typesense, { Client } from 'typesense';
import { getServiceRoleClient } from '../../src/lib/supabase/client';
import {
  soldListingsSchema,
  SOLD_LISTINGS_COLLECTION,
  type SoldListingDocument,
} from '../../src/lib/typesense/soldListingsSchema';
import { resolveLocation } from './resolveLocation';
import { parsePostalFromAddress } from './parsePostal';
import { assignSchools } from '../../src/lib/schools/nearestSchools';
import { selectPrimaryImage, primaryImageFromPhotos } from '../../src/lib/etl/selectPrimaryImage';
import { deriveDealType } from '../../src/lib/sold/dealType';

export const SOLD_WINDOW_DAYS = 180; // mirrors MAX_WINDOW_DAYS in the sold route
const IMPORT_CHUNK = 100;
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;

let adminClient: Client | null = null;

/** Admin (write-capable) Typesense client — server/worker only. */
export function getSoldAdminClient(): Client {
  if (!adminClient) {
    const key = process.env.TYPESENSE_ADMIN_API_KEY;
    if (!key) throw new Error('TYPESENSE_ADMIN_API_KEY is not set in environment');
    adminClient = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
      apiKey: key,
      connectionTimeoutSeconds: 15,
    });
  }
  return adminClient;
}

export function windowCutoffMs(days = SOLD_WINDOW_DAYS): number {
  return Date.now() - days * 86_400_000;
}

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function toFloat(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Structural subset of raw_vow_sold columns needed to build a sold document. */
export interface SoldIndexInput {
  listing_key: string;
  unparsed_address: string | null;
  city_region: string | null;
  city: string | null;
  /** Required for Tier-1 geocoding → location + NearbySchools (Phase 2B). */
  postal_code: string | null;
  property_sub_type: string | null;
  building_area_total: number | null;
  lot_width: number | null;
  bedrooms_above_grade: number | null;
  bedrooms_below_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  /** Garage (covered) spaces — null when the feed omits it (≠ 0 = no garage). */
  covered_spaces: number | null;
  list_price: number | null;
  close_price: number;
  purchase_contract_date: string | null;
  basement_tier: number;
  /** Raw board status signals for deriving DealType (real values, not price). */
  mls_status: string | null;
  transaction_type: string | null;
}

/**
 * Map a raw_vow_sold row → Typesense sold document. Returns null (skip) when there is
 * no valid `purchase_contract_date`, since the window filter keys on it and such a row
 * could never be queried anyway (mirrors the old route's `.gte(purchase_contract_date)`).
 *
 * Geocoding (Phase 2B): postal-code Tier 1 only. We deliberately pass `null` for the
 * API-native lat/lng inputs of `resolveLocation` so a postal miss falls through to
 * tiers 3-4 (city centre / Toronto centre) and gets `needsGeocoding === true` — at
 * which point we DROP the `location` field rather than ship a noisy fallback that
 * would silently match every Toronto-overlapping polygon. Same for NearbySchools.
 */
export function toSoldDocument(
  r: SoldIndexInput,
  listOfficeName: string | null,
  /**
   * Optional thumbnail source. Two shapes, because the two callers have different data:
   *  - `{ media, images }` — the incremental path (ingester.ts Query B) holds the live
   *    VOW feed record in memory, so it still has the full media array for free.
   *  - `{ photos }` — the backfill path reads the stored `photos` column
   *    (migration 101) instead of the raw_payload->media sub-tree it used to pull.
   * Both resolve to the same URL; see primaryImageFromPhotos for why.
   */
  rawMedia?: { media?: unknown; images?: unknown; photos?: unknown }
): SoldListingDocument | null {
  if (!r.listing_key) return null;
  if (!r.purchase_contract_date) return null;
  const ms = new Date(r.purchase_contract_date).getTime();
  if (!Number.isFinite(ms)) return null;

  const primaryImageUrl = !rawMedia
    ? null
    : rawMedia.photos !== undefined
      ? primaryImageFromPhotos(rawMedia.photos)
      : selectPrimaryImage(rawMedia as { media?: any[]; images?: any[] });

  // raw_vow_sold carries the grade split but no separate total column, so the true
  // BedroomsTotal is above + below. (Previously BedroomsTotal was set to above-grade
  // ONLY — a latent bug: a 4+2 sold home indexed as "4", mismatching the subject's
  // true total of 6 in the comparables matcher.)
  const bedsAbove = toInt(r.bedrooms_above_grade);
  const bedsBelow = toInt(r.bedrooms_below_grade);
  const doc: SoldListingDocument = {
    id: r.listing_key,
    ClosePrice: toInt(r.close_price),
    ListPrice: toInt(r.list_price),
    City: r.city ?? '',
    CityRegion: r.city_region ?? '',
    UnparsedAddress: r.unparsed_address ?? '',
    PropertySubType: r.property_sub_type ?? '',
    BedroomsTotal: bedsAbove + bedsBelow,
    BedroomsAboveGrade: bedsAbove,
    BedroomsBelowGrade: bedsBelow,
    BathroomsTotalInteger: toFloat(r.bathrooms_total_integer),
    BuildingAreaTotal: toInt(r.building_area_total),
    ParkingTotal: toInt(r.parking_total),
    LotWidth: toFloat(r.lot_width),
    BasementTier: toInt(r.basement_tier),
    ListOfficeName: listOfficeName ?? '',
    PurchaseContractDate: ms,
  };
  // Optional: only emit when the feed has a value, so "unknown garage" stays absent
  // (neutral in the comp score) rather than collapsing to 0 = "no garage".
  if (r.covered_spaces != null) doc.CoveredSpaces = toInt(r.covered_spaces);
  if (primaryImageUrl) doc.primaryImageUrl = primaryImageUrl;
  doc.DealType = deriveDealType(r.mls_status, r.transaction_type);

  // VOW `postal_code` is frequently the FSA only (→ FSA-centroid blob); the full
  // postal is in the address. Prefer it; fall back to the column.
  const geoPostal = parsePostalFromAddress(r.unparsed_address) ?? r.postal_code;
  const geo = resolveLocation(geoPostal, null, null, r.city);
  if (!geo.needsGeocoding) {
    doc.location = geo.location;
    const schools = assignSchools(geo.location);
    if (schools.NearbySchools.length > 0) {
      doc.NearbySchools = schools.NearbySchools;
    }
  }

  return doc;
}

/**
 * Upsert a batch of sold docs into Typesense (chunked). Returns success/fail counts.
 * Docs that fail get ONE retry pass: a transient per-doc import error otherwise drops
 * the row from the dashboard SOLD panel until the next window reindex — days of a
 * quiet, plausible-looking gap (exactly the 2026-07-22 East Gwillimbury report).
 */
export async function importSoldBatch(
  client: Client,
  docs: SoldListingDocument[]
): Promise<{ success: number; failed: number }> {
  const importChunks = async (input: SoldListingDocument[]) => {
    let ok = 0;
    const failedDocs: SoldListingDocument[] = [];
    for (let i = 0; i < input.length; i += IMPORT_CHUNK) {
      const chunk = input.slice(i, i + IMPORT_CHUNK);
      if (chunk.length === 0) continue;
      const resp = await client
        .collections(SOLD_LISTINGS_COLLECTION)
        .documents()
        .import(chunk, { action: 'upsert' });
      const results = Array.isArray(resp)
        ? resp
        : JSON.parse(resp as unknown as string);
      results.forEach((res: { success: boolean; error?: string }, j: number) => {
        if (res.success) ok++;
        else {
          failedDocs.push(chunk[j]);
          console.warn(`   ⚠️  sold_listings import error (${chunk[j]?.id}): ${res.error ?? 'unknown'}`);
        }
      });
    }
    return { ok, failedDocs };
  };

  const first = await importChunks(docs);
  let success = first.ok;
  let failed = 0;
  if (first.failedDocs.length > 0) {
    const retry = await importChunks(first.failedDocs);
    success += retry.ok;
    failed = retry.failedDocs.length;
    if (failed > 0) {
      console.error(
        `   ❌ ${failed} sold doc(s) failed to index after retry — they will be invisible in the SOLD panel until the next window reindex: ${retry.failedDocs.map((d) => d.id).join(', ')}`
      );
    }
  }
  return { success, failed };
}

/** Delete docs older than the rolling window so the collection stays bounded. */
export async function pruneOldSold(
  client: Client,
  days = SOLD_WINDOW_DAYS
): Promise<void> {
  const cutoff = windowCutoffMs(days);
  try {
    const res: any = await client
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .delete({ filter_by: `PurchaseContractDate:<${cutoff}` });
    console.log(`   🧹 Pruned ${res?.num_deleted ?? 0} sold docs older than ${days}d`);
  } catch (err: any) {
    console.warn(`   ⚠️  Sold prune failed (non-fatal): ${err.message}`);
  }
}

// ============================================================================
// Backfill CLI — seed the window from raw_vow_sold
// ============================================================================

const BACKFILL_PAGE = 1000;

/**
 * Backfill seeds the collection from raw_vow_sold. CRITICAL: paginate by the PRIMARY
 * KEY (listing_key) via keyset, NOT offset+`order(purchase_contract_date)`. There is no
 * index on purchase_contract_date, so ordering by it sorts the whole table → statement
 * timeout. Ordering by the PK uses its index (no sort); each keyset page is ~1-2s.
 */
/**
 * Existing id → primaryImageUrl, so a re-index can never DESTROY a thumbnail.
 *
 * A Typesense upsert replaces the whole document, so any row whose thumbnail can no longer
 * be derived comes back blank — and ~19% of rows in the 180-day window have no `photos`
 * (measured 2026-07-28: 84,835 of 104,714). Without this, re-indexing to FIX thumbnails
 * would simultaneously destroy the ones that survive from before migration 102 stripped
 * raw_payload->media. Mirrors the clobber protection the active path already runs
 * (mediaEnrichment.preserveExistingMedia), for the same reason.
 *
 * One streamed export of two fields; a failure degrades to "no protection", never a crash.
 */
async function exportExistingThumbnails(client: Client): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const raw: string = await client
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .export({ include_fields: 'id,primaryImageUrl' });
    for (const line of raw.split('\n')) {
      if (!line) continue;
      const doc = JSON.parse(line) as { id?: string; primaryImageUrl?: string };
      if (doc.id && doc.primaryImageUrl) map.set(doc.id, doc.primaryImageUrl);
    }
  } catch (err: any) {
    console.warn(`   ⚠️  Could not export existing thumbnails (non-fatal): ${err.message}`);
  }
  return map;
}

async function backfill(days = SOLD_WINDOW_DAYS): Promise<void> {
  console.log(`\n🌱 sold_listings backfill — last ${days}d from raw_vow_sold`);
  const supabase = getServiceRoleClient();
  const client = getSoldAdminClient();

  const existingThumbs = await exportExistingThumbnails(client);
  console.log(`   🛡️  ${existingThumbs.size} existing thumbnails held as fallback`);
  let preserved = 0;

  const cutoffISO = new Date(windowCutoffMs(days)).toISOString();
  const nowISO = new Date().toISOString();
  const columns =
    'listing_key, unparsed_address, city_region, city, postal_code, property_sub_type, ' +
    'building_area_total, lot_width, bedrooms_above_grade, bedrooms_below_grade, ' +
    'covered_spaces, bathrooms_total_integer, ' +
    'parking_total, list_price, close_price, purchase_contract_date, basement_tier, ' +
    'brokerage:raw_payload->>ListOfficeName, ' +
    'mls_status:raw_payload->>MlsStatus, txn_type:raw_payload->>TransactionType, ' +
    // Thumbnail comes from the flat `photos` column (migration 101) — already
    // Active-only, de-duplicated and Order-sorted. This previously pulled the
    // raw_payload->media sub-tree: ~37 eight-field objects per row, of which only the
    // first URL was ever used. The `images` key was read here too and exists on no row
    // (0 of 2,000 sampled), so it is dropped.
    'photos';

  let lastKey = '';
  let totalSeen = 0;
  let totalImported = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (;;) {
    let q = supabase
      .from('raw_vow_sold')
      .select(columns)
      .gte('purchase_contract_date', cutoffISO)
      .lte('purchase_contract_date', nowISO)
      .order('listing_key', { ascending: true })
      .limit(BACKFILL_PAGE);
    if (lastKey) q = q.gt('listing_key', lastKey);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;

    totalSeen += rows.length;
    lastKey = rows[rows.length - 1].listing_key;

    const docs: SoldListingDocument[] = [];
    for (const row of rows) {
      const doc = toSoldDocument(
        { ...(row as any), mls_status: row.mls_status ?? null, transaction_type: row.txn_type ?? null } as SoldIndexInput,
        row.brokerage ?? null,
        { photos: row.photos }
      );
      if (doc) {
        // Keep whatever the collection already had when this row can no longer supply one.
        if (!doc.primaryImageUrl) {
          const kept = existingThumbs.get(doc.id);
          if (kept) {
            doc.primaryImageUrl = kept;
            preserved++;
          }
        }
        docs.push(doc);
      }
      else totalSkipped++;
    }

    if (docs.length > 0) {
      const { success, failed } = await importSoldBatch(client, docs);
      totalImported += success;
      totalFailed += failed;
    }
    console.log(
      `   📄 seen ${totalSeen}: imported ${totalImported}, failed ${totalFailed}, skipped ${totalSkipped} (lastKey ${lastKey})`
    );

    if (rows.length < BACKFILL_PAGE) break;
  }

  await pruneOldSold(client);
  console.log(
    `\n✅ Backfill complete: ${totalImported} imported, ${totalFailed} failed, ${totalSkipped} skipped (no contract date).` +
      `\n   🛡️  ${preserved} thumbnails preserved from the existing index (row had no photos).`
  );
}

// Only run the CLI when invoked directly (not when imported by the ingester).
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /soldIndexer\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  (async () => {
    const mode = process.argv[2] || 'backfill';
    if (mode === 'backfill') {
      // --days N bounds the reindex window (default: the full 180d collection window).
      // The nightly sync runs `backfill --days 7` as a self-heal: any row the inline
      // Query B indexing missed (transient import failure, geocode hiccup) is re-derived
      // from the vault within 24h instead of waiting for the Sun/Wed reconcile.
      const daysIdx = process.argv.indexOf('--days');
      const days = daysIdx > -1 ? Number(process.argv[daysIdx + 1]) : SOLD_WINDOW_DAYS;
      if (!Number.isFinite(days) || days < 1 || days > SOLD_WINDOW_DAYS) {
        console.error(`--days must be 1-${SOLD_WINDOW_DAYS}, got "${process.argv[daysIdx + 1]}"`);
        process.exit(1);
      }
      await backfill(days);
      process.exit(0);
    }
    if (mode === 'prune') {
      await pruneOldSold(getSoldAdminClient());
      process.exit(0);
    }
    console.error(`Unknown mode "${mode}". Use: backfill [--days N] | prune`);
    process.exit(1);
  })().catch((err) => {
    console.error('❌ soldIndexer failed:', err.message);
    process.exit(1);
  });
}
