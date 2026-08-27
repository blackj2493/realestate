/**
 * Stale search-doc reconciliation for the Typesense `properties` collection.
 *
 * Query A (IDX) only ever fetches `StandardStatus eq 'Active'`, so a listing
 * that leaves Active is never seen by the active sync again — its `properties`
 * doc freezes at its last Active state ("New", "Price Change", ...) and keeps
 * showing as For Sale/For Lease forever. Query B (VOW sold) deliberately skips
 * the Typesense write (RAM/OOM policy), which also means nothing deletes the
 * stale doc. These helpers compute which doc ids must be DELETED from the
 * search index for a given batch; sync.ts performs the chunked deletes.
 */

/**
 * Terminal statuses — the listing is no longer available inventory and must
 * not appear in search. "Sold Conditional" is intentionally absent (still
 * conditionally available). Single source of truth shared with sync.ts.
 */
export const NON_ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'sold',
  'closed',
  'closed sale',
  'leased',
  'terminated',
  'expired',
  'suspended',
]);

/**
 * Doc ids whose `properties` documents are stale and must be deleted.
 *
 * Sold batch (Query B): every id — each record is a firm sale/lease, so any
 * doc still in the For Sale index under that ListingKey is stale. A later
 * deal-fell-through re-activation bumps ModificationTimestamp and Query A
 * re-indexes it.
 *
 * Active batch (Query A): ids whose Status is terminal — they are filtered
 * out of the upsert, so deleting is the only way their old doc ever leaves.
 */
/**
 * ListingKeys in this batch whose firm sale COLLAPSED, so their raw_vow_sold anchor is a
 * price nobody ever paid.
 *
 * raw_vow_sold is the AVM's sale-anchor table: each row asserts "this listing closed at
 * close_price on purchase_contract_date". Query B writes one the moment the feed reports
 * StandardStatus 'Closed', and nothing ever removes it. When a deal collapses TRREB flips
 * the listing back to Active with MlsStatus 'Deal Fell Through' — the record returns via
 * Query A, but the anchor stays behind, priced and dated and indistinguishable from a real
 * close. 107 had accumulated by 2026-08-27 (~18/month), carrying $50.6M in phantom prices.
 *
 * Deleting is right rather than merely suspicious-looking: the row states something false.
 * If the property does sell later under the same ListingKey, Query B re-adds the anchor
 * with the real number, so nothing is permanently lost.
 */
export function collectFellThroughKeys(rawListings: Array<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const raw of rawListings) {
    if (String(raw?.MlsStatus ?? '').trim().toLowerCase() !== 'deal fell through') continue;
    const key = typeof raw?.ListingKey === 'string' ? raw.ListingKey.trim() : '';
    if (key) keys.add(key);
  }
  return [...keys];
}

export function collectStaleSearchDocIds(
  docs: Array<{ id?: unknown; Status?: unknown }>,
  options?: { isSold?: boolean }
): string[] {
  const ids = new Set<string>();
  for (const doc of docs) {
    const id = typeof doc.id === 'string' ? doc.id.trim() : '';
    if (!id) continue;
    if (options?.isSold) {
      ids.add(id);
      continue;
    }
    const status = String(doc.Status ?? '').trim().toLowerCase();
    if (NON_ACTIVE_STATUSES.has(status)) ids.add(id);
  }
  return [...ids];
}

/**
 * Chunked `id:=[...]` filter strings for deleteByFilter calls (ListingKeys are
 * alphanumeric — no escaping needed). Chunking keeps each filter bounded.
 */
export function buildIdDeleteFilters(ids: string[], chunkSize = 100): string[] {
  const filters: string[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    filters.push(`id:=[${ids.slice(i, i + chunkSize).join(',')}]`);
  }
  return filters;
}
