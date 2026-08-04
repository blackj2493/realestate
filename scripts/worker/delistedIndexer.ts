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
 *    doc upsert. No AMPRE media fetch — the thumbnail is stamped from the record's
 *    surviving `listings` row (enrichThumbnailsFromListings), matching sold comps.
 *    Consumer-only surface (the comp ledger is VOW-gated), so nothing new is exposed.
 *  - Stale-active cleanup: every batch's keys are deleted from `properties`
 *    (a terminated listing's For Sale doc is frozen stale — same bug class as
 *    the sold purge, PR #19).
 *
 * CLI:
 *   npx tsx scripts/worker/delistedIndexer.ts backfill   (seed cursor 12mo back, run to caught-up)
 *   npx tsx scripts/worker/delistedIndexer.ts delta      (one capped run, as the nightly does)
 *   npx tsx scripts/worker/delistedIndexer.ts prune      (prune the 90d window only)
 *   npx tsx scripts/worker/delistedIndexer.ts thumbs     (one-off: stamp thumbnails onto existing de-listed docs)
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
import { firstMediaUrl } from '../../src/lib/sold/firstMediaUrl';
import { partitionSupersededDelisted } from './purgeSupersededDelisted';

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

// ── feed fetch (single-orderby paging; AMPRE rejects compound $orderby) ──────
// TRREB ModificationTimestamps are second-precision: a bulk status change can
// put >100 records in the same second, so `gt cursor` alone would silently
// skip the same-timestamp tail. AMPRE rejects both compound $orderby and
// keyset or-filters with error 1109 "The URI is malformed" (probe-verified
// 2026-06-10), so the tail is handled by DRAINING the boundary second with an
// `eq` filter + $skip — the same $skip pattern Query A/B already rely on.
async function fetchDelistedPage(filter: string, skip = 0): Promise<any[]> {
  const token = process.env.PROPTX_VOW_TOKEN;
  if (!token) throw new Error('PROPTX_VOW_TOKEN environment variable is not set');
  const url =
    `${API_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}` +
    `&$orderby=${encodeURIComponent('ModificationTimestamp asc')}&$top=100` +
    (skip > 0 ? `&$skip=${skip}` : '');
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
  // Board data sends fractional values where you'd expect integers (e.g.
  // ParkingTotal "3.5", DaysOnMarket "3.5") — round for the INTEGER columns
  // or Postgres rejects the whole batch ("invalid input syntax for type integer").
  const intOrNull = (v: number | null): number | null => (v == null ? null : Math.round(v));
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
    days_on_market: intOrNull(r.days_on_market),
    unparsed_address: r.unparsed_address,
    city: r.city,
    city_region: r.city_region,
    postal_code: r.postal_code,
    property_sub_type: r.property_sub_type,
    bedrooms_above_grade: intOrNull(r.bedrooms_above_grade),
    bathrooms_total_integer: r.bathrooms_total_integer,
    parking_total: intOrNull(r.parking_total),
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

/**
 * Best-effort: stamp each windowed doc's thumbnail from its surviving `listings`
 * row's media_urls. The delisted VOW feed carries no media (v1 cards were blank),
 * but the listings row survives with the same photos the detail page shows. The
 * terminal comp ledger is VOW-gated (consumer-only), so this exposes nothing new.
 *
 * Non-fatal BY DESIGN: any failure just leaves the docs photo-less, exactly as
 * before — it can never break the delisted sync. Only fills docs missing a thumb.
 */
async function enrichThumbnailsFromListings(docs: SoldListingDocument[]): Promise<void> {
  const targets = docs.filter((d) => !d.primaryImageUrl && d.id);
  if (targets.length === 0) return;
  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from('listings')
      .select('listing_key, media_urls')
      .in('listing_key', targets.map((d) => d.id));
    if (error || !data) return;
    const byKey = new Map<string, unknown>();
    for (const row of data as Array<{ listing_key: unknown; media_urls: unknown }>) {
      byKey.set(String(row.listing_key), row.media_urls);
    }
    for (const doc of targets) {
      const url = firstMediaUrl(byKey.get(doc.id));
      if (url) doc.primaryImageUrl = url;
    }
  } catch (err: any) {
    console.warn(`   ⚠️  De-listed thumbnail enrich failed (non-fatal): ${err?.message || err}`);
  }
}

/**
 * Keep the slim Supabase archive at its 12-month design size — without this it
 * grows ~330k rows/year unbounded. Cheap: delisted_date is indexed and the
 * nightly delete removes roughly one day's worth (~900 rows). Non-fatal.
 */
export async function pruneOldDelistedArchive(months = DELISTED_ARCHIVE_MONTHS): Promise<void> {
  const cutoff = new Date(Date.now() - months * 30.44 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  try {
    const supabase = getServiceRoleClient();
    const { count, error } = await supabase
      .from('raw_vow_delisted')
      .delete({ count: 'exact' })
      .lt('delisted_date', cutoff);
    if (error) throw new Error(error.message);
    console.log(`   🧹 Archive: pruned ${count ?? 0} de-listed rows older than ${cutoff}`);
  } catch (err: any) {
    console.warn(`   ⚠️  Archive prune failed (non-fatal): ${err?.message || err}`);
  }
}

/**
 * Prune BOTH de-listed stores: docs beyond the 90-day Typesense window
 * (sold/leased keep 180d via pruneOldSold) and archive rows beyond 12 months.
 * Every caller (nightly Query C + all CLI modes) wants the pair together.
 */
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
  await pruneOldDelistedArchive();
}

export interface DelistedSyncResult {
  records: number;
  pages: number;
  indexed: number;
  /** De-lists withheld from the index because the property has since closed. */
  superseded: number;
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
  console.log(`   📖 De-listed cursor: ${cursor}`);
  // A row stuck at 'running' = a run crashed mid-flight (success/failure
  // overwrite it with 'completed'/'failed' below).
  await updateDelistedCursor(cursor, 'running');
  const windowCutoff = Date.now() - DELISTED_WINDOW_DAYS * 86_400_000;
  const result: DelistedSyncResult = {
    records: 0,
    pages: 0,
    indexed: 0,
    superseded: 0,
    caughtUp: false,
  };

  /** Persist one page: archive upsert + windowed index + stale-active delete. */
  const persistPage = async (listings: any[]): Promise<void> => {
    const nowMs = Date.now();
    const records = listings
      .map((l) => extractDelistedRecord(l, nowMs))
      .filter((r): r is DelistedRecord => r !== null);

    await upsertDelistedRecords(records);

    const windowed = records
      .map((r) => toWindowedDoc(r, windowCutoff))
      .filter((d): d is SoldListingDocument => d !== null);

    // Drop de-lists whose property has ALREADY closed (relisted under a new MLS# that
    // then sold). Query C replays such records on a `backfill` and whenever TRREB
    // re-touches an old terminated row, which would otherwise re-insert the exact pin
    // the sold side just purged — the two directions of the same fix. Superseded docs
    // are deleted rather than merely skipped, since an earlier run may have indexed
    // them. The Supabase archive above keeps them regardless (detail-page truth).
    // See purgeSupersededDelisted.ts.
    const { keep: docs, superseded } = await partitionSupersededDelisted(
      getSoldAdminClient(),
      windowed
    );
    if (superseded.length > 0) {
      result.superseded += superseded.length;
      try {
        const ts = getSoldAdminClient();
        for (const filter of buildIdDeleteFilters(superseded.map((d) => d.id))) {
          await ts.collections(SOLD_LISTINGS_COLLECTION).documents().delete({ filter_by: filter } as any);
        }
      } catch (err: any) {
        console.warn(`   ⚠️  Superseded de-listed delete failed (non-fatal): ${err.message}`);
      }
      console.log(`   🧹 Skipped ${superseded.length} de-list(s) whose property has since closed`);
    }

    if (docs.length > 0) {
      await enrichThumbnailsFromListings(docs); // best-effort thumbnail from the surviving listings row
      const { success, failed } = await importSoldBatch(getSoldAdminClient(), docs);
      result.indexed += success;
      if (failed > 0) console.warn(`   ⚠️  ${failed} de-listed docs failed to index`);
    }

    // These listings left Active — their For Sale docs are frozen stale.
    // Inverse edge: a Suspended/Terminated listing that re-activates under the SAME
    // ListingKey re-enters `properties` via Query A on its next modification, but its
    // amber comp doc remains in sold_listings for up to 90d (dual markers) — accepted,
    // same class as the sold deal-fell-through edge.
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
  };

  try {
    while (result.pages < maxPages) {
      const listings = await fetchDelistedPage(
        `${STATUS_FILTER} and ModificationTimestamp gt ${cursor}`
      );
      if (listings.length === 0) {
        result.caughtUp = true;
        break;
      }
      await persistPage(listings);
      result.records += listings.length;
      result.pages++;

      const lastTs = listings[listings.length - 1]?.ModificationTimestamp;
      if (!lastTs) {
        // Defensive: a page that can't advance the cursor would loop forever.
        console.warn('   ⚠️  Page has no ModificationTimestamp on its last record — stopping.');
        result.caughtUp = listings.length < 100;
        break;
      }
      console.log(`   📄 De-listed page ${result.pages}: +${listings.length} (cursor → ${lastTs})`);

      if (listings.length < 100) {
        // Short page = feed exhausted; the boundary second arrived complete.
        cursor = lastTs;
        result.caughtUp = true;
        break;
      }

      // Full page: the boundary may have split lastTs's second (second-precision
      // feed; bulk status changes can exceed 100 records/second). Drain that
      // second fully via `eq` + $skip before advancing the cursor past it. The
      // overlap with rows already persisted above is idempotent (upserts).
      let drainComplete = false;
      const eqFilter = `${STATUS_FILTER} and ModificationTimestamp eq ${lastTs}`;
      for (let skip = 0; result.pages < maxPages; skip += 100) {
        await sleep(PAGE_DELAY_MS);
        const drain = await fetchDelistedPage(eqFilter, skip);
        if (drain.length > 0) {
          await persistPage(drain);
          result.records += drain.length;
          result.pages++;
          console.log(`   📄 De-listed drain: +${drain.length} @ ${lastTs} (skip ${skip})`);
        }
        if (drain.length < 100) {
          drainComplete = true;
          break;
        }
      }
      if (!drainComplete) {
        // Page cap hit mid-drain — leave the cursor BEFORE lastTs so the next
        // run re-fetches and re-drains that second (idempotent), never skips it.
        break;
      }
      cursor = lastTs;
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
      console.log(
        `✅ Delta complete: ${r.records} records, ${r.indexed} indexed, ${r.superseded} superseded, caughtUp=${r.caughtUp}`
      );
      process.exit(0);
    }
    if (mode === 'prune') {
      await pruneOldDelisted();
      process.exit(0);
    }
    if (mode === 'thumbs') {
      // One-off: stamp thumbnails onto EXISTING de-listed docs from their surviving
      // listings rows. New de-lists get thumbnails automatically via the nightly
      // (enrichThumbnailsFromListings); this repairs the ones already indexed.
      // Non-destructive — a partial `action:update` that only sets primaryImageUrl.
      const ts = getSoldAdminClient();
      const supabase = getServiceRoleClient();
      const jsonl = (await ts
        .collections(SOLD_LISTINGS_COLLECTION)
        .documents()
        .export({
          filter_by: 'DealType:=[terminated,expired,suspended]',
          include_fields: 'id,primaryImageUrl',
        } as any)) as unknown as string;
      const rows = jsonl
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id: string; primaryImageUrl?: string });
      const missing = rows.filter((r) => !r.primaryImageUrl).map((r) => r.id);
      console.log(`🖼️  De-listed docs missing a thumbnail: ${missing.length} / ${rows.length}`);
      let stamped = 0;
      const CHUNK = 200;
      for (let i = 0; i < missing.length; i += CHUNK) {
        const keys = missing.slice(i, i + CHUNK);
        const { data } = await supabase
          .from('listings')
          .select('listing_key, media_urls')
          .in('listing_key', keys);
        const byKey = new Map<string, unknown>();
        for (const row of (data ?? []) as Array<{ listing_key: unknown; media_urls: unknown }>) {
          byKey.set(String(row.listing_key), row.media_urls);
        }
        const updates = keys
          .map((id) => ({ id, primaryImageUrl: firstMediaUrl(byKey.get(id)) }))
          .filter((u): u is { id: string; primaryImageUrl: string } => !!u.primaryImageUrl);
        if (updates.length > 0) {
          await ts
            .collections(SOLD_LISTINGS_COLLECTION)
            .documents()
            .import(updates, { action: 'update' } as any);
          stamped += updates.length;
        }
        console.log(`   …${Math.min(i + CHUNK, missing.length)}/${missing.length} scanned · ${stamped} stamped`);
      }
      console.log(`✅ Thumbs backfill complete: ${stamped} de-listed thumbnails stamped from listings.`);
      process.exit(0);
    }
    console.error(`Unknown mode "${mode}". Use: backfill | delta | prune | thumbs`);
    process.exit(1);
  })().catch((err) => {
    console.error('❌ delistedIndexer failed:', err?.message || err);
    process.exit(1);
  });
}
