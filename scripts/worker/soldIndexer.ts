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
  property_sub_type: string | null;
  building_area_total: number | null;
  lot_width: number | null;
  bedrooms_above_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  list_price: number | null;
  close_price: number;
  purchase_contract_date: string | null;
  basement_tier: number;
}

/**
 * Map a raw_vow_sold row → Typesense sold document. Returns null (skip) when there is
 * no valid `purchase_contract_date`, since the window filter keys on it and such a row
 * could never be queried anyway (mirrors the old route's `.gte(purchase_contract_date)`).
 */
export function toSoldDocument(
  r: SoldIndexInput,
  listOfficeName: string | null
): SoldListingDocument | null {
  if (!r.listing_key) return null;
  if (!r.purchase_contract_date) return null;
  const ms = new Date(r.purchase_contract_date).getTime();
  if (!Number.isFinite(ms)) return null;

  return {
    id: r.listing_key,
    ClosePrice: toInt(r.close_price),
    ListPrice: toInt(r.list_price),
    City: r.city ?? '',
    CityRegion: r.city_region ?? '',
    UnparsedAddress: r.unparsed_address ?? '',
    PropertySubType: r.property_sub_type ?? '',
    BedroomsTotal: toInt(r.bedrooms_above_grade),
    BathroomsTotalInteger: toFloat(r.bathrooms_total_integer),
    BuildingAreaTotal: toInt(r.building_area_total),
    ParkingTotal: toInt(r.parking_total),
    LotWidth: toFloat(r.lot_width),
    BasementTier: toInt(r.basement_tier),
    ListOfficeName: listOfficeName ?? '',
    PurchaseContractDate: ms,
  };
}

/** Upsert a batch of sold docs into Typesense (chunked). Returns success/fail counts. */
export async function importSoldBatch(
  client: Client,
  docs: SoldListingDocument[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  for (let i = 0; i < docs.length; i += IMPORT_CHUNK) {
    const chunk = docs.slice(i, i + IMPORT_CHUNK);
    if (chunk.length === 0) continue;
    const resp = await client
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .import(chunk, { action: 'upsert' });
    const results = Array.isArray(resp)
      ? resp
      : JSON.parse(resp as unknown as string);
    for (const res of results) {
      if (res.success) success++;
      else {
        failed++;
        console.warn(`   ⚠️  sold_listings import error: ${res.error ?? 'unknown'}`);
      }
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
async function backfill(): Promise<void> {
  console.log(`\n🌱 sold_listings backfill — last ${SOLD_WINDOW_DAYS}d from raw_vow_sold`);
  const supabase = getServiceRoleClient();
  const client = getSoldAdminClient();

  const cutoffISO = new Date(windowCutoffMs()).toISOString();
  const nowISO = new Date().toISOString();
  const columns =
    'listing_key, unparsed_address, city_region, city, property_sub_type, ' +
    'building_area_total, lot_width, bedrooms_above_grade, bathrooms_total_integer, ' +
    'parking_total, list_price, close_price, purchase_contract_date, basement_tier, ' +
    'brokerage:raw_payload->>ListOfficeName';

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
      const doc = toSoldDocument(row as SoldIndexInput, row.brokerage ?? null);
      if (doc) docs.push(doc);
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
    `\n✅ Backfill complete: ${totalImported} imported, ${totalFailed} failed, ${totalSkipped} skipped (no contract date).`
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
      await backfill();
      process.exit(0);
    }
    if (mode === 'prune') {
      await pruneOldSold(getSoldAdminClient());
      process.exit(0);
    }
    console.error(`Unknown mode "${mode}". Use: backfill | prune`);
    process.exit(1);
  })().catch((err) => {
    console.error('❌ soldIndexer failed:', err.message);
    process.exit(1);
  });
}
