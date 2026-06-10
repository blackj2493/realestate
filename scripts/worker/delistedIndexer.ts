/**
 * De-listed (Terminated/Expired/Suspended) VOW listings → Supabase archive +
 * Typesense window. Query C of the sync (design spec 2026-06-09).
 *
 *  - Cursored on ModificationTimestamp (FILTERABLE on these statuses, unlike
 *    Query B's date fields) with $orderby asc — the cursor advances per page,
 *    so there is no deep-$skip and any run is resumable.
 *  - Own sync_state row (id='delisted') so a Query C failure NEVER moves the
 *    master cursor, and vice versa. Failed runs keep the previous cursor.
 *  - Routes: every record → raw_vow_delisted upsert (12-month slim archive);
 *    records with a de-list date inside DELISTED_WINDOW_DAYS → sold_listings
 *    doc upsert. No media fetches (v1 cards are photo-less).
 *  - Stale-active cleanup: every batch's keys are deleted from `properties`
 *    (a terminated listing's For Sale doc is frozen stale — same bug class as
 *    the sold purge, PR #19).
 *
 * CLI:
 *   npx tsx scripts/worker/delistedIndexer.ts backfill   (seed cursor 12mo back, run to caught-up)
 *   npx tsx scripts/worker/delistedIndexer.ts delta      (one capped run, as the nightly does)
 *   npx tsx scripts/worker/delistedIndexer.ts prune      (prune the 90d window only)
 */
import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';
import { getSoldAdminClient, importSoldBatch } from './soldIndexer';
import { SOLD_LISTINGS_COLLECTION } from '../../src/lib/typesense/soldListingsSchema';
import type { SoldListingDocument } from '../../src/lib/typesense/soldListingsSchema';
import { extractDelistedRecord, toDelistedDocument, type DelistedRecord } from './delistedMapper';
import { buildIdDeleteFilters } from './staleSearchDocs';
import { resolveLocation } from './resolveLocation';
import { assignSchools } from '../../src/lib/schools/nearestSchools';

export const DELISTED_WINDOW_DAYS = 90;
export const DELISTED_ARCHIVE_MONTHS = 12;
const API_BASE_URL = 'https://query.ampre.ca/odata';
const PAGE_DELAY_MS = 1000;
/** Nightly page cap: ~900 new records/day needs ~9 pages; 50 gives catch-up slack. */
const DELTA_MAX_PAGES = 50;
const CURSOR_ROW_ID = 'delisted';

const STATUS_FILTER =
  "(MlsStatus eq 'Terminated' or MlsStatus eq 'Expired' or MlsStatus eq 'Suspended')";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── sync_state cursor (own row — never the 'master' row) ─────────────────────
export async function readDelistedCursor(defaultIso: string): Promise<string> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from('sync_state')
    .select('last_sync_timestamp')
    .eq('id', CURSOR_ROW_ID)
    .maybeSingle();
  if (error) throw new Error(`read delisted cursor: ${error.message}`);
  if (!data) {
    const { error: insErr } = await supabase
      .from('sync_state')
      .insert({ id: CURSOR_ROW_ID, last_sync_timestamp: defaultIso, status: 'idle' });
    if (insErr) throw new Error(`init delisted cursor: ${insErr.message}`);
    return defaultIso;
  }
  return data.last_sync_timestamp;
}

export async function updateDelistedCursor(
  timestamp: string,
  status: 'running' | 'completed' | 'failed'
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from('sync_state')
    .update({ last_sync_timestamp: timestamp, status, updated_at: new Date().toISOString() })
    .eq('id', CURSOR_ROW_ID);
  if (error) throw new Error(`update delisted cursor: ${error.message}`);
}

// ── feed fetch (keyset paging on (ModificationTimestamp, ListingKey)) ────────
// TRREB ModificationTimestamps are second-precision: a bulk status change can
// put >100 records in the same second, so `gt cursor` alone would silently
// skip the same-timestamp tail. The (timestamp, key) keyset walks through it.
async function fetchDelistedPage(cursorIso: string, afterKey: string | null): Promise<any[]> {
  const token = process.env.PROPTX_VOW_TOKEN;
  if (!token) throw new Error('PROPTX_VOW_TOKEN environment variable is not set');
  const filter =
    afterKey === null
      ? `${STATUS_FILTER} and ModificationTimestamp gt ${cursorIso}`
      : `${STATUS_FILTER} and (ModificationTimestamp gt ${cursorIso} or (ModificationTimestamp eq ${cursorIso} and ListingKey gt '${afterKey}'))`;
  const url =
    `${API_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}` +
    `&$orderby=${encodeURIComponent('ModificationTimestamp asc, ListingKey asc')}&$top=100`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data: any = await res.json();
      return data.value ?? [];
    }
    if (attempt >= 3) throw new Error(`Query C fetch failed: HTTP ${res.status}`);
    await sleep(attempt * 2000);
  }
}

// ── Supabase upsert (field-by-field per CLAUDE.md section 6, batched) ────────
export async function upsertDelistedRecords(records: DelistedRecord[]): Promise<void> {
  if (records.length === 0) return;
  const supabase = getServiceRoleClient();
  const rows = records.map((r) => ({
    listing_key: r.listing_key,
    mls_status: r.mls_status,
    standard_status: r.standard_status,
    transaction_type: r.transaction_type,
    delisted_date: r.delisted_date,
    expiration_date: r.expiration_date,
    listing_contract_date: r.listing_contract_date,
    list_price: r.list_price,
    original_list_price: r.original_list_price,
    days_on_market: r.days_on_market,
    unparsed_address: r.unparsed_address,
    city: r.city,
    city_region: r.city_region,
    postal_code: r.postal_code,
    property_sub_type: r.property_sub_type,
    bedrooms_above_grade: r.bedrooms_above_grade,
    bathrooms_total_integer: r.bathrooms_total_integer,
    parking_total: r.parking_total,
    list_office_name: r.list_office_name,
    lat: null as number | null,
    lng: null as number | null,
    updated_at: new Date().toISOString(),
  }));
  // Geocode (postal Tier-1 only, same policy as soldIndexer — drop fallbacks).
  for (let i = 0; i < rows.length; i++) {
    const geo = resolveLocation(records[i].postal_code, null, null, records[i].city);
    if (!geo.needsGeocoding) {
      rows[i].lat = geo.location[0];
      rows[i].lng = geo.location[1];
    }
  }
  const { error } = await supabase
    .from('raw_vow_delisted')
    .upsert(rows, { onConflict: 'listing_key' });
  if (error) throw new Error(`raw_vow_delisted upsert: ${error.message}`);
}

/** Doc + geo for the bounded window; null when outside the window. */
function toWindowedDoc(r: DelistedRecord, windowCutoffMs: number): SoldListingDocument | null {
  const eventMs = new Date(r.delisted_date).getTime();
  if (!Number.isFinite(eventMs) || eventMs < windowCutoffMs) return null;
  const doc = toDelistedDocument(r);
  if (!doc) return null;
  const geo = resolveLocation(r.postal_code, null, null, r.city);
  if (!geo.needsGeocoding) {
    doc.location = geo.location;
    const schools = assignSchools(geo.location);
    if (schools.NearbySchools.length > 0) doc.NearbySchools = schools.NearbySchools;
  }
  return doc;
}

/** Prune de-listed docs beyond their 90-day window (sold/leased keep 180d via pruneOldSold). */
export async function pruneOldDelisted(days = DELISTED_WINDOW_DAYS): Promise<void> {
  const cutoff = Date.now() - days * 86_400_000;
  try {
    const res: any = await getSoldAdminClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .delete({
        filter_by: `DealType:=[terminated,expired,suspended] && PurchaseContractDate:<${cutoff}`,
      });
    console.log(`   🧹 Pruned ${res?.num_deleted ?? 0} de-listed docs older than ${days}d`);
  } catch (err: any) {
    console.warn(`   ⚠️  De-listed prune failed (non-fatal): ${err.message}`);
  }
}

export interface DelistedSyncResult {
  records: number;
  pages: number;
  indexed: number;
  caughtUp: boolean;
}

/**
 * Catch up from the cursor, up to maxPages. Used by BOTH the nightly sync
 * (capped) and the backfill CLI (loops until caughtUp). The cursor only
 * advances after each page fully persists — a crash re-runs the page (upserts
 * make that safe).
 */
export async function runDelistedSync(maxPages = DELTA_MAX_PAGES): Promise<DelistedSyncResult> {
  const defaultIso = new Date(Date.now() - 48 * 3600_000).toISOString();
  let cursor = await readDelistedCursor(defaultIso);
  // Same-second tail position within `cursor` — in-memory only. Persistence is
  // timestamp-only: a restart re-fetches and re-upserts the same-second tail,
  // which is idempotent and acceptable.
  let afterKey: string | null = null;
  console.log(`   📖 De-listed cursor: ${cursor}`);
  // A row stuck at 'running' = a run crashed mid-flight (success/failure
  // overwrite it with 'completed'/'failed' below).
  await updateDelistedCursor(cursor, 'running');
  const windowCutoff = Date.now() - DELISTED_WINDOW_DAYS * 86_400_000;
  const result: DelistedSyncResult = { records: 0, pages: 0, indexed: 0, caughtUp: false };

  try {
    while (result.pages < maxPages) {
      const listings = await fetchDelistedPage(cursor, afterKey);
      if (listings.length === 0) {
        result.caughtUp = true;
        break;
      }
      const nowMs = Date.now();
      const records = listings
        .map((l) => extractDelistedRecord(l, nowMs))
        .filter((r): r is DelistedRecord => r !== null);

      await upsertDelistedRecords(records);

      const docs = records
        .map((r) => toWindowedDoc(r, windowCutoff))
        .filter((d): d is SoldListingDocument => d !== null);
      if (docs.length > 0) {
        const { success, failed } = await importSoldBatch(getSoldAdminClient(), docs);
        result.indexed += success;
        if (failed > 0) console.warn(`   ⚠️  ${failed} de-listed docs failed to index`);
      }

      // These listings left Active — their For Sale docs are frozen stale.
      const keys = records.map((r) => r.listing_key);
      if (keys.length > 0) {
        try {
          const ts = getSoldAdminClient();
          for (const filter of buildIdDeleteFilters(keys)) {
            await ts.collections('properties').documents().delete({ filter_by: filter } as any);
          }
        } catch (err: any) {
          console.warn(`   ⚠️  Stale-active delete failed (non-fatal): ${err.message}`);
        }
      }

      // Advance the (ModificationTimestamp, ListingKey) keyset to the last record.
      const last = listings[listings.length - 1];
      if (!last?.ModificationTimestamp) {
        // Defensive: a page that can't advance the keyset would loop forever.
        console.warn('   ⚠️  Page has no ModificationTimestamp on its last record — stopping.');
        result.caughtUp = listings.length < 100;
        break;
      }
      if (last.ModificationTimestamp === cursor) {
        // Same-second run: progress through it via the key, timestamp unchanged.
        afterKey = last.ListingKey;
      } else {
        cursor = last.ModificationTimestamp;
        afterKey = last.ListingKey ?? null;
      }
      result.records += listings.length;
      result.pages++;
      console.log(
        `   📄 De-listed page ${result.pages}: +${listings.length} (cursor → ${cursor}${afterKey ? ` after ${afterKey}` : ''})`
      );
      if (listings.length < 100) {
        result.caughtUp = true;
        break;
      }
      await sleep(PAGE_DELAY_MS);
    }
    await updateDelistedCursor(cursor, 'completed');
  } catch (err: any) {
    console.error(`   ❌ De-listed sync failed: ${err?.message || err}`);
    // Cursor intentionally NOT advanced past the last fully-persisted page.
    await updateDelistedCursor(cursor, 'failed').catch(() => {});
    throw err;
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /delistedIndexer\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  (async () => {
    const mode = process.argv[2] || 'delta';
    if (mode === 'backfill') {
      const archiveStart = new Date(
        Date.now() - DELISTED_ARCHIVE_MONTHS * 30.44 * 86_400_000
      ).toISOString();
      let current = await readDelistedCursor(archiveStart);
      // The nightly delta may have created the row at its 48h default, which
      // would limit a "backfill" to 48 hours. Rewind any cursor newer than the
      // archive start (upserts make the overlap safe). A cursor at/before the
      // archive start is an in-progress backfill — keep it (resumable).
      if (current > archiveStart) {
        await updateDelistedCursor(archiveStart, 'completed');
        current = archiveStart;
        console.log(`🌱 Cursor rewound to ${archiveStart} for 12-month backfill`);
      }
      console.log(`🌱 De-listed backfill from cursor ${current}`);
      let total = 0;
      let caughtUp = false;
      // Hard ceiling: 100 × 200 pages × 100 records = 2M, far beyond any real backfill.
      for (let i = 0; i < 100; i++) {
        const r = await runDelistedSync(200);
        total += r.records;
        console.log(`   …${total} records so far (caughtUp=${r.caughtUp})`);
        if (r.caughtUp) {
          caughtUp = true;
          break;
        }
      }
      if (!caughtUp) {
        console.warn('   ⚠️  Backfill hit the 100-iteration ceiling without catching up — re-run to resume.');
      }
      await pruneOldDelisted();
      console.log(`✅ Backfill complete: ${total} records archived.`);
      process.exit(0);
    }
    if (mode === 'delta') {
      const r = await runDelistedSync();
      await pruneOldDelisted();
      console.log(`✅ Delta complete: ${r.records} records, ${r.indexed} indexed, caughtUp=${r.caughtUp}`);
      process.exit(0);
    }
    if (mode === 'prune') {
      await pruneOldDelisted();
      process.exit(0);
    }
    console.error(`Unknown mode "${mode}". Use: backfill | delta | prune`);
    process.exit(1);
  })().catch((err) => {
    console.error('❌ delistedIndexer failed:', err?.message || err);
    process.exit(1);
  });
}
