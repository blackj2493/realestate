/**
 * Typesense schema for the `sold_listings` collection — recently-SOLD (VOW) comps.
 *
 * WHY A SEPARATE, LEAN COLLECTION (not reusing `properties`):
 *  - `properties` is the ACTIVE IDX feed (public-display). Sold is VOW data with
 *    stricter display rules, so it lives in its own collection that the public
 *    browser key must NOT be able to read (queried server-side only — see the
 *    /api/market/activity/sold route).
 *  - RAM POLICY: this collection holds only a ROLLING 180-DAY WINDOW of sold rows
 *    (the dashboard never queries further back), pruned each sync. So we index ONLY
 *    the handful of fields the Market Activity panel filters/sorts/shows — keeping
 *    the in-memory footprint tiny and constant as the historical archive grows.
 *    The full ~217k historical record stays in Supabase `raw_vow_sold` for AVM.
 *
 * Field NAMES intentionally mirror the `properties` collection where the concept is
 * shared (City, CityRegion, PropertySubType, BedroomsTotal, …) so the sold
 * filter_by builder mirrors `buildActivityFilter` in src/lib/dashboard/queries.ts.
 *
 * `PurchaseContractDate` is the "sold firm" date stored as EPOCH MS (int64), mirroring
 * `EntryTimestamp` on the active side, so the window filter (`:>=cutoffMs`) and the
 * default desc sort both work as integer range ops.
 */

export const SOLD_LISTINGS_COLLECTION = 'sold_listings';

export const soldListingsSchema = {
  name: SOLD_LISTINGS_COLLECTION,
  fields: [
    { name: 'id', type: 'string' as const, facet: false }, // = listing_key
    { name: 'ClosePrice', type: 'int32' as const, facet: false, sort: true },
    { name: 'ListPrice', type: 'int32' as const, facet: false, sort: true },
    { name: 'City', type: 'string' as const, facet: true },
    { name: 'CityRegion', type: 'string' as const, facet: true },
    { name: 'UnparsedAddress', type: 'string' as const, facet: false, optional: true },
    { name: 'PropertySubType', type: 'string' as const, facet: true },
    { name: 'BedroomsTotal', type: 'int32' as const, facet: false, sort: true },
    // float (not int32): VOW bathrooms_total_integer is NUMERIC and can be fractional (e.g. 2.5).
    { name: 'BathroomsTotalInteger', type: 'float' as const, facet: false, sort: true },
    { name: 'BuildingAreaTotal', type: 'int32' as const, facet: false, sort: true },
    { name: 'ParkingTotal', type: 'int32' as const, facet: false, sort: true },
    { name: 'LotWidth', type: 'float' as const, facet: false, sort: true },
    // Deterministic basement condition tier (1-9); <=5 == "has finished space".
    { name: 'BasementTier', type: 'int32' as const, facet: false, sort: true },
    { name: 'ListOfficeName', type: 'string' as const, index: false, facet: false, optional: true },
    // "Sold firm" date as epoch ms — window filter + default desc sort.
    { name: 'PurchaseContractDate', type: 'int64' as const, facet: false, sort: true },
  ],
  default_sorting_field: 'PurchaseContractDate',
};

/** TypeScript shape of a `sold_listings` document. */
export interface SoldListingDocument {
  id: string;
  ClosePrice: number;
  ListPrice: number;
  City: string;
  CityRegion: string;
  UnparsedAddress?: string;
  PropertySubType: string;
  BedroomsTotal: number;
  BathroomsTotalInteger: number;
  BuildingAreaTotal: number;
  ParkingTotal: number;
  LotWidth: number;
  BasementTier: number;
  ListOfficeName?: string;
  PurchaseContractDate: number; // epoch ms
}
