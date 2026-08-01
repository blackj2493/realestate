/**
 * Typesense Client Library
 * 
 * Provides typed search helpers for the Shadow MLS search layer.
 * Optimized for <30ms search responses with geospatial support.
 * 
 * Uses SEARCH_ONLY_API_KEY - read-only operations only.
 */

import Typesense, { Client } from 'typesense';
import { searchCities } from '@/lib/cities';
import { bandFilter, type HistogramBand } from '@/lib/filters/histogram';
import { aboveGradeBedsClause } from '@/lib/filters/filterRegistry';
import { anyTransactionPriceFloor } from '@/lib/filters/fundamentals';
import { toSimpleRing } from '@/lib/geo/simplifyRing';
import { sqftBoundsFor } from '@/lib/listings/livingAreaBands';
import { reportSearchFailure } from '@/lib/telemetry/searchHealth';
import { rankAddressSuggestions } from '@/lib/search/addressRank';

// Typesense configuration.
// NOTE: the host is intentionally hardcoded (Typesense Cloud) and is NOT read from env.
// There is no NEXT_PUBLIC_TYPESENSE_HOST — the old value pointed at a decommissioned
// Railway box. The sync ETL (scripts/worker/sync.ts) writes to this same host; keep them
// in lockstep if the cluster ever moves.
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const SEARCH_API_KEY = process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY ?? '';

// Singleton client
let client: Client | null = null;

/**
 * Get Typesense client instance (singleton)
 */
export function getTypesenseClient(): Client {
  if (!client) {
    if (!SEARCH_API_KEY) {
      throw new Error(
        'Typesense search key is missing — NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY must be set at next build time.'
      );
    }
    client = new Typesense.Client({
      nodes: [
        {
          host: TYPESENSE_HOST,
          port: TYPESENSE_PORT,
          protocol: 'https'
        }
      ],
      apiKey: SEARCH_API_KEY,
      // Send the (already-public, search-only) key as a URL query param instead of the
      // X-TYPESENSE-API-KEY header. That custom header forced a CORS *preflight* (OPTIONS)
      // on every browser→Typesense GET, and the preflight cache is keyed by full URL, so
      // each distinct query re-paid a 1–6s OPTIONS. Without the custom header these GET
      // searches are "simple requests" → no preflight at all. (The key is already in the
      // client bundle via NEXT_PUBLIC, so putting it in the URL is not a new exposure.)
      sendApiKeyAsQueryParam: true,
      // Resilience: healthy queries answer in <1s, so a request that hasn't responded
      // in a few seconds is almost certainly a STALE keep-alive connection (cloud LBs
      // silently drop idle conns; the browser reuses the dead one and the request hangs).
      // The old 30s timeout turned that into a 30s "Network Error" that blanked the
      // terminal. Fail fast (8s) and let the client retry on a FRESH connection — which
      // succeeds immediately since the cluster itself is healthy.
      // Balance: 8s was too aggressive — a legitimately heavy query that crossed 8s
      // got aborted and retry-stormed (3×8s) instead of completing. 15s tolerates an
      // occasional slow query while still failing a genuinely stuck (stale keep-alive)
      // connection so the retry can land on a fresh one.
      connectionTimeoutSeconds: 15,  // was 30, then briefly 8
      numRetries: 2,
      retryIntervalSeconds: 1,
      healthcheckIntervalSeconds: 15, // re-probe a node marked unhealthy sooner (default 60)
    });
  }
  return client;
}

/**
 * Full-population distribution counts for a numeric field, one per band, fetched
 * as batched COUNT queries (per_page:0 → just `found`) in a single multi_search
 * round-trip. `baseFilterBy` should already exclude this field's own clause so
 * the bars reflect every OTHER active filter without self-collapsing. RAM-safe:
 * no faceting of the numeric field (see histogram.ts / the 2026-05-19 RAM policy).
 */
export async function searchHistogram(params: {
  field: string;
  baseFilterBy: string;
  bands: HistogramBand[];
}): Promise<number[]> {
  const { field, baseFilterBy, bands } = params;
  if (!bands.length) return [];
  const searches = bands.map((b) => ({
    collection: 'properties',
    q: '*',
    query_by: 'City',
    filter_by: [baseFilterBy, bandFilter(field, b)].filter(Boolean).join(' && '),
    per_page: 0,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await getTypesenseClient().multiSearch.perform({ searches } as any);
  return (res.results ?? []).map((r: { found?: number }) => r.found ?? 0);
}

/**
 * COUNT-only results for a list of arbitrary filter fragments, in one
 * multi_search round-trip. Generalises {@link searchHistogram} to clauses that
 * aren't a single field's range — the sqft band control needs per-band counts
 * (unequal-width TRREB bands) plus its certain/possible/unsized totals, and none
 * of those are expressible as `bandFilter`.
 *
 * A fragment of "" counts the unfiltered base. Order in = order out.
 */
export async function searchClauseCounts(params: {
  baseFilterBy: string;
  clauses: string[];
}): Promise<number[]> {
  const { baseFilterBy, clauses } = params;
  if (!clauses.length) return [];
  const searches = clauses.map((c) => ({
    collection: 'properties',
    q: '*',
    query_by: 'City',
    filter_by: [baseFilterBy, c].filter(Boolean).join(' && '),
    per_page: 0,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await getTypesenseClient().multiSearch.perform({ searches } as any);
  return (res.results ?? []).map((r: { found?: number }) => r.found ?? 0);
}

// ============================================================================
// Type Definitions (matches updated schema with camelCase fields)
// ============================================================================

export interface ListingDocument {
  id: string;  // Maps to ListingKey
  
  // Core Render Fields
  ListPrice: number;
  UnparsedAddress?: string;
  City?: string;
  /** TRREB community ("Half Moon Bay", "Sandringham-Wellington") — the neighbourhood axis. */
  CityRegion?: string;

  // Property Specs
  BedroomsTotal?: number;
  BedroomsAboveGrade?: number;
  BedroomsBelowGrade?: number;
  BathroomsTotalInteger?: number;
  PropertySubType?: string;
  PropertyType?: string;
  
  // Geopoint: [latitude, longitude]
  location: [number, number];
  
  // Coordinates from postal code lookup (populated by API layer)
  Latitude?: number;
  Longitude?: number;
  
  // Transaction
  TransactionType?: string;
  
  // Financial
  TaxAnnualAmount?: number;
  AssociationFee?: number;
  
  // Lot Dimensions
  LotWidth?: number;
  LotDepth?: number;
  
  // Building Specs
  ApproximateAge?: string;
  ParkingTotal?: number;
  BuildingAreaTotal?: number;
  // TRREB sqft band ("2500-3000"). Stored-only display cargo; BuildingAreaTotal is
  // ~never filled for houses, so this is the sqft fallback on cards / quick-look.
  LivingAreaRange?: string;
  // The same size as filterable interval bounds. Derived from the two fields above
  // when absent, so every write path gets them without having to remember.
  sqft_min?: number;
  sqft_max?: number;
  
  // Derived Metrics
  isDistressed: boolean;
  hasSecondarySuitePotential: boolean;
  calculatedDOM?: number;
  
  // Thumbnail
  thumbnailUrl?: string;
  
  // Brokerage
  ListOfficeName?: string;
  
  // Extended fields for Command Center
  TrueDom?: number;
  primaryImageUrl?: string;

  // Full deduped photo URL array (unindexed Typesense cargo `RawImages`) — used by
  // the Compare media cell to scroll all photos with no extra fetch. May be empty.
  RawImages?: string[];
  OriginalListPrice?: number;
  KitchensBelowGrade?: number;
  SchoolZone?: boolean;
  PublicRemarks?: string;
  
  // Building Systems
  Heating?: string;
  Cooling?: string[];
  
  // Cap Rate Metrics
  TotalCapitalBasis?: number;
  ExtrapolatedCapRate?: number;
  CapitalBurnRateMonthly?: number;
  
  // Property Hash (Phase 4)
  PropertyHash?: string;
  
  // Price Drop
  TotalPriceDrop?: number;
  
  // ─── Phase 5: True Carry Cost ─────────────────────────────────────────
  MonthlyCarryCost?: number;
  MonthlyMortgage?: number;
  MonthlyPropertyTax?: number;
  MonthlyHOA?: number;
  MonthlyInsurance?: number;
  MonthlyCapEx?: number;
  
  // ─── Phase 5: Suite Analysis ─────────────────────────────────────────
  SuiteStatus?: 'NONE' | 'POTENTIAL_CANDIDATE' | 'EXISTING_SUITE';
  SuiteScore?: number;
  
  // ─── Phase 5: Stale Inventory ─────────────────────────────────────────
  IsStale?: boolean;

  // ─── Cap Rate / Yield (Phase 5 estimates) ────────────────────────────
  cap_rate_est?: number;
  gross_yield_est?: number;

  // ─── Builder / Density / Zoning ──────────────────────────────────────
  LotSqftTotal?: number;
  lot_width_ft?: number;
  lot_depth_ft?: number;
  zoning_designation?: string; // municipal zone CODE (harvest-populated; MLS source is empty)
  zoning_desc?: string;        // plain-language zone name (display cargo, from harvest)
  zoning_source?: string;      // provenance key → src/lib/zoning/attribution.ts (display cargo)
  multiplex_by_right?: boolean;
  multi_unit_status?: 'NOT_VIABLE' | 'EXISTING_MULTI_UNIT' | 'PRIME_CANDIDATE' | 'MARGINAL_CANDIDATE' | string;
  is_density_ready?: boolean;
  surplus_parking_count?: number;
  infrastructure_flag?: string;
  BasementType?: string[];
  KitchensTotal?: number;

  // ─── Status / DOM ────────────────────────────────────────────────────
  Status?: string;
  DaysOnMarket?: number;

  // ─── Sold-comp overlay (set only by the sold adapter; see src/lib/sold/adapter.ts) ─
  /** True when this doc is an adapted VOW sold comp, not an active IDX listing. */
  IsSoldComp?: boolean;
  /** Sold ("purchase contract") date as ISO string — sold comps only. */
  SoldDate?: string;
  /** Comp layer for an adapted VOW comp; absent for active docs. */
  compKind?: "sold" | "leased" | "terminated" | "expired" | "suspended";
  /** Leased ("contract") date as ISO string — leased comps only. */
  LeasedDate?: string;
  /** De-list date as ISO string — terminated/expired/suspended comps only. */
  DelistedDate?: string;

  // Entry timestamp (epoch) — sortable; powers "freshest" + since-last-visit.
  EntryTimestamp?: number;

  // ─── School-Aware Search (nearest rated school per panel) ─────────────
  ElemPublicScore?: number;
  ElemCatholicScore?: number;
  SecPublicScore?: number;
  SecCatholicScore?: number;
  BestElementaryScore?: number;
  BestSecondaryScore?: number;
  BestSchoolScoreNearby?: number;
  NearbySchools?: string[];
  ElemPublicSchool?: string;
  ElemPublicDistanceKm?: number;
  ElemCatholicSchool?: string;
  ElemCatholicDistanceKm?: number;
  SecPublicSchool?: string;
  SecPublicDistanceKm?: number;
  SecCatholicSchool?: string;
  SecCatholicDistanceKm?: number;

  // ─── Amenity proximity (Overture Maps / OSM) — walkability ────────────────
  // Straight-line km to the nearest grocery / recreation centre (NO_AMENITY_KM=99 when
  // none within MAX_AMENITY_KM). Km is indexed + sortable; names are display cargo.
  NearestGroceryKm?: number;
  NearestGroceryName?: string;
  NearestRecCentreKm?: number;
  NearestRecCentreName?: string;
}

export interface SearchFilters {
  // Location
  city?: string;
  boundingBox?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  
  // Price
  minPrice?: number;
  maxPrice?: number;
  
  // Property Specs
  minBedrooms?: number;
  maxBedrooms?: number;
  minBathrooms?: number;
  propertySubTypes?: string[];
  propertyTypes?: string[];
  
  // Financial
  // NOTE: no maxTaxes filter — TaxAnnualAmount is intentionally index:false in the
  // Typesense schema (display/calc only, not filterable), so a tax filter would 400.
  maxAssociationFee?: number;
  
  // Transaction
  transactionType?: 'For Sale' | 'For Lease';
  
  // Derived Metrics
  isDistressed?: boolean;
  hasSecondarySuitePotential?: boolean;
  // Lot Dimensions (for Value-Add / Developer)
  minLotWidth?: number;
  maxLotWidth?: number;
  minLotDepth?: number;
  maxLotDepth?: number;
  hasUnfinishedBasement?: boolean;
  hasDetachedGarage?: boolean;
  
  // Days on Market
  minDOM?: number;
  maxDOM?: number;
  
  // True DOM (Phase 4)
  minTrueDom?: number;
  maxTrueDom?: number;
}

export interface SearchOptions {
  query: string;
  filters?: SearchFilters;
  page?: number;
  perPage?: number;
  sortBy?: string;  // Overrides default sort
  sortOrder?: 'asc' | 'desc';
  rawFilterBy?: string;  // Raw Typesense filter_by string (appended via &&) for persona builders
  geoPolygon?: [number, number][];  // Commute isochrone ring in [lat, lng] order
  facetBy?: string;
  maxFacetValues?: number;  // facet values to return (default 50; city hubs need all districts)
  /** Typesense exclude_fields. Defaults to the heavy detail-only fields (RawImages /
   *  RawRooms) so bulk list/map fetches stay light; pass "" to fetch every field. */
  excludeFields?: string;
}

export interface SearchResult {
  listings: ListingDocument[];
  totalFound: number;
  page: number;
  perPage: number;
  processingTimeMs: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Search listings with typed filters
 * Uses debouncing in the frontend to avoid excessive requests
 */
export async function searchListings(
  options: SearchOptions
): Promise<SearchResult> {
  const client = getTypesenseClient();
  
  const {
    query,
    filters = {},
    page = 1,
    perPage: rawPerPage = 20,
    sortBy,
    sortOrder = 'asc',
    rawFilterBy,
    geoPolygon,
    facetBy,
    maxFacetValues,
    excludeFields
  } = options;

  // TRREB §4: never let any caller exceed the 100-listing display cap (audit LOW-1).
  const perPage = Math.min(100, Math.max(1, rawPerPage));

  // Build filter string
  const filterParts: string[] = [];

  // Raw filter_by passthrough (persona builders emit colon-operator strings)
  if (rawFilterBy && rawFilterBy.trim()) {
    filterParts.push(rawFilterBy.trim());
  }
  
  // City filter - exact match (no operator needed for string equality)
  if (filters.city) {
    filterParts.push(`City:=${filters.city}`);
  }
  
  // Price filters - Typesense requires colon before operator: FieldName:>=Value
  if (filters.minPrice !== undefined) {
    const minVal = Math.floor(filters.minPrice);
    filterParts.push(`ListPrice:>=${minVal}`);
  }
  if (filters.maxPrice !== undefined) {
    const maxVal = Math.floor(filters.maxPrice);
    filterParts.push(`ListPrice:<=${maxVal}`);
  }
  
  // Bedroom filter — above-grade with a total fallback (see aboveGradeBedsClause),
  // matching the For Sale search, the dashboard scope and the sold lens so "3 beds"
  // means 3 ABOVE grade and a "1+2" basement home doesn't surface under it.
  if (filters.minBedrooms !== undefined) {
    filterParts.push(aboveGradeBedsClause(filters.minBedrooms));
  }
  
  // Bathroom filter
  if (filters.minBathrooms !== undefined) {
    filterParts.push(`BathroomsTotalInteger:>=${filters.minBathrooms}`);
  }
  
  // Property SubType filter (multi-select)
  if (filters.propertySubTypes && filters.propertySubTypes.length > 0) {
    const subtypeFilter = filters.propertySubTypes
      .map(st => `PropertySubType:=${st}`)
      .join(' || ');
    filterParts.push(`(${subtypeFilter})`);
  }
  
  // Property Type filter (multi-select)
  if (filters.propertyTypes && filters.propertyTypes.length > 0) {
    const typeFilter = filters.propertyTypes
      .map(pt => `PropertyType:=${pt}`)
      .join(' || ');
    filterParts.push(`(${typeFilter})`);
  }
  
  // Financial filters
  // (no TaxAnnualAmount filter: that field is index:false — see SearchFilters above)
  if (filters.maxAssociationFee !== undefined) {
    filterParts.push(`AssociationFee:<=${filters.maxAssociationFee}`);
  }
  
  // Transaction Type - exact match. Backtick-quote: the value ("For Sale"/"For
  // Lease") contains a space, which Typesense mis-parses unquoted. Filterable since
  // TransactionType was added to the collection (scripts/admin/add-transaction-type.ts).
  if (filters.transactionType) {
    filterParts.push(`TransactionType:=\`${filters.transactionType}\``);
  }
  
  // Derived metrics
  if (filters.isDistressed !== undefined) {
    filterParts.push(`isDistressed:=${filters.isDistressed}`);
  }
  if (filters.hasSecondarySuitePotential !== undefined) {
    filterParts.push(`hasSecondarySuitePotential:=${filters.hasSecondarySuitePotential}`);
  }
  
  // Lot dimensions (for Value-Add/Developer)
  if (filters.minLotWidth !== undefined) {
    filterParts.push(`LotWidth:>=${filters.minLotWidth}`);
  }
  if (filters.maxLotWidth !== undefined) {
    filterParts.push(`LotWidth:<=${filters.maxLotWidth}`);
  }
  if (filters.minLotDepth !== undefined) {
    filterParts.push(`LotDepth:>=${filters.minLotDepth}`);
  }
  if (filters.maxLotDepth !== undefined) {
    filterParts.push(`LotDepth:<=${filters.maxLotDepth}`);
  }
  
  // Bedroom range
  if (filters.maxBedrooms !== undefined) {
    filterParts.push(`BedroomsTotal:<=${filters.maxBedrooms}`);
  }
  
  // Days on Market (calculatedDOM)
  if (filters.minDOM !== undefined) {
    filterParts.push(`calculatedDOM:>=${filters.minDOM}`);
  }
  if (filters.maxDOM !== undefined) {
    filterParts.push(`calculatedDOM:<=${filters.maxDOM}`);
  }
  
  // True DOM (Phase 4)
  if (filters.minTrueDom !== undefined) {
    filterParts.push(`TrueDom:>=${filters.minTrueDom}`);
  }
  if (filters.maxTrueDom !== undefined) {
    filterParts.push(`TrueDom:<=${filters.maxTrueDom}`);
  }
  
  // Build search params
  const searchParams: Record<string, unknown> = {
    q: query || '*',
    query_by: 'City,CityRegion,PropertySubType',
    page,
    per_page: perPage,
  };

  if (facetBy) {
    searchParams.facet_by = facetBy;
    searchParams.max_facet_values = maxFacetValues ?? 50;
  }

  // Trim the payload. RawImages (the full photo-URL gallery — ~1.1 MB per 100 docs)
  // and RawRooms are detail-page-only; bulk list/map views never render them, yet
  // shipping them made every terminal query ~1.7 MB and multi-second. Default-exclude
  // both (~75% smaller). A caller that genuinely needs them passes excludeFields: "".
  const exclude = excludeFields ?? "RawImages,RawRooms";
  if (exclude) searchParams.exclude_fields = exclude;

  // Serve repeated identical queries (return-to-view, re-applied filters, the dashboard's
  // stable scopes) from Typesense's result cache instead of recomputing. Listing data only
  // changes on the daily sync, so the ~60s cache window is never meaningfully stale.
  searchParams.use_cache = true;

  // Apply filter string
  if (filterParts.length > 0) {
    const filterString = filterParts.join(' && ');
    console.log('[Typesense] Filter string:', filterString);
    searchParams.filter_by = filterString;
  }
  
  // Custom sort
  if (sortBy) {
    searchParams.sort_by = `${sortBy}:${sortOrder}`;
  }
  
  // Geospatial bounding box — Typesense geo filter expects a polygon of
  // (lat, lng) pairs. Build the 4 corners from the viewport bounds.
  if (filters.boundingBox) {
    const { north, south, east, west } = filters.boundingBox;
    const geoFilter = `location:(${south}, ${west}, ${south}, ${east}, ${north}, ${east}, ${north}, ${west})`;
    searchParams.filter_by = searchParams.filter_by
      ? `${searchParams.filter_by} && ${geoFilter}`
      : geoFilter;
  }

  // Commute isochrone polygon — same geopoint mechanism as the bounding box.
  // geoPolygon is already [lat, lng] pairs; flatten into the location:() filter.
  if (geoPolygon && geoPolygon.length >= 3) {
    // Typesense 400s on closed or self-intersecting rings. /api/isochrone now
    // emits simple open rings, but commute bubbles SAVED before that fix still
    // replay the old broken shape — repair any ring at query time (the geometry
    // is coordinate-order agnostic).
    const ring = toSimpleRing(geoPolygon, 50);
    if (ring.length >= 3) {
      const coords = ring.map(([lat, lng]) => `${lat}, ${lng}`).join(', ');
      const polyFilter = `location:(${coords})`;
      searchParams.filter_by = searchParams.filter_by
        ? `${searchParams.filter_by} && ${polyFilter}`
        : polyFilter;
    }
  }

  const startedAt = Date.now();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client
      .collections('properties')
      .documents()
      .search(searchParams);

    // Typesense returns facets as `facet_counts: [{ field_name, counts: [{ value, count }] }]`
    // (NOT `facet_distribution`). Reshape into { field: { value: count } } for the filter palette.
    const facetCountsRaw: Array<{ field_name: string; counts: Array<{ value: string; count: number }> }> =
      response.facet_counts || [];
    const facetDistribution: Record<string, Record<string, number>> = {};
    for (const f of facetCountsRaw) {
      facetDistribution[f.field_name] = Object.fromEntries(
        (f.counts || []).map((c) => [c.value, c.count])
      );
    }

    return {
      listings: (response.hits || []).map((hit: { document: ListingDocument }) => hit.document),
      totalFound: response.found || 0,
      page: response.page || page,
      perPage: perPage,
      processingTimeMs: response.search_time_ms || 0,
      facetDistribution,
    };
  } catch (error) {
    // Log detailed error info
    console.error('[Typesense] Search error:', error);
    if (error && typeof error === 'object' && 'httpBody' in error) {
      const tsError = error as { httpBody?: string; httpStatus?: number };
      console.error('[Typesense] HTTP Status:', tsError.httpStatus);
      console.error('[Typesense] HTTP Body:', tsError.httpBody);
    }
    // The browser talks to Typesense Cloud directly, so server logs never see these
    // failures — beacon them (fire-and-forget, self-limiting, browser-only no-op on
    // the server) so sustained flakiness can trip the ops alert.
    reportSearchFailure(error, Date.now() - startedAt, { fn: 'searchListings' });
    throw error;
  }
}

/**
 * A search-bar autocomplete suggestion. Places (city / neighbourhood) carry a
 * live active-listing `count`; addresses and MLS hits carry the full `listing`
 * so selecting one can open that property directly.
 */
export interface SearchSuggestion {
  kind: 'city' | 'neighbourhood' | 'address' | 'mls';
  label: string;
  sublabel?: string;            // e.g. the address under an MLS#
  count?: number;               // city / neighbourhood only
  listing?: ListingDocument;    // address / mls only
  /** Geocoded not-listed address rows only — powers the explicit Map/Profile
   *  action pair in the header dropdown (centered-map deep link needs coords). */
  geo?: { lat: number; lng: number };
}

/**
 * Placeholder-price floor for the typeahead. Reads each document's own
 * `TransactionType` rather than assuming a sale — see anyTransactionPriceFloor.
 * This used to be a bare `ListPrice:>=100000`, which hid every lease listing
 * (a lease's ListPrice is a monthly rent) and made searched addresses come back
 * as unrelated streets.
 */
const LISTING_FLOOR = anyTransactionPriceFloor();
// TRREB MLS keys look like a board letter + 6–9 digits (e.g. W12632618, X13162416).
const MLS_RE = /^[A-Za-z]\d{6,9}$/;

/** Pull place suggestions (city / neighbourhood) from a faceted response. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function placesFromFacets(response: any, needle: string): SearchSuggestion[] {
  const seen = new Set<string>();
  const places: SearchSuggestion[] = [];
  const facets: Array<{ field_name: string; counts: Array<{ value: string; count: number }> }> =
    response.facet_counts || [];
  for (const facet of facets) {
    const kind: SearchSuggestion['kind'] = facet.field_name === 'City' ? 'city' : 'neighbourhood';
    for (const { value, count } of facet.counts || []) {
      if (!value || !value.toLowerCase().includes(needle)) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      places.push({ kind, label: value, count });
    }
  }
  places.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return places;
}

/**
 * Terminal search-bar typeahead. Surfaces, in priority order:
 *   1. an exact MLS# match (input looks like a listing key) → opens that listing,
 *   2. street-address matches (when the query has a digit, i.e. street-number intent),
 *   3. cities / neighbourhoods with their live active-listing counts.
 *
 * One faceted query does double duty: its `hits` are address matches and its
 * `facet_counts` are the city/region suggestions. If `UnparsedAddress` isn't
 * indexed yet (pre-migration), it retries place-only so city/region typeahead
 * keeps working; total failure falls back to the static city list.
 */
export async function suggestSearch(query: string): Promise<SearchSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const needle = q.toLowerCase();
  const client = getTypesenseClient();
  const out: SearchSuggestion[] = [];

  // 1) MLS# exact lookup — the MLS key IS the Typesense document id.
  if (MLS_RE.test(q)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await client.collections('properties').documents().search({
        q: '*',
        query_by: 'City',
        filter_by: `id:=${q.toUpperCase()}`,
        per_page: 1,
      });
      const doc = r.hits?.[0]?.document as ListingDocument | undefined;
      if (doc) out.push({ kind: 'mls', label: `MLS# ${doc.id}`, sublabel: doc.UnparsedAddress, listing: doc });
    } catch {
      /* MLS lookup failed — fall through to the place/address search */
    }
  }

  // 2) Combined address-hits + place-facets. Retry place-only if address isn't indexed.
  const baseParams = {
    q,
    filter_by: LISTING_FLOOR,
    facet_by: 'City,CityRegion',
    max_facet_values: 100,
    per_page: 6,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: any = null;
  let addressSearchable = true;
  try {
    response = await client.collections('properties').documents().search({
      ...baseParams,
      query_by: 'UnparsedAddress,City,CityRegion',
    });
  } catch {
    addressSearchable = false;
    try {
      response = await client.collections('properties').documents().search({
        ...baseParams,
        query_by: 'City,CityRegion',
      });
    } catch (error) {
      console.error('[Typesense] suggestSearch error — falling back to static cities:', error);
    }
  }

  if (response) {
    const places = placesFromFacets(response, needle);

    // Show address hits only when the query carries a street number (digit) or
    // there are no place matches — otherwise a plain city name floods the list
    // with that city's listings (their addresses all contain the city name).
    const addresses: SearchSuggestion[] = [];
    if (addressSearchable && (/\d/.test(q) || places.length === 0)) {
      const seenAddr = new Set<string>();
      for (const h of (response.hits || []) as Array<{ document: ListingDocument }>) {
        const doc = h.document;
        if (!doc?.UnparsedAddress || seenAddr.has(doc.id)) continue;
        seenAddr.add(doc.id);
        addresses.push({ kind: 'address', label: doc.UnparsedAddress, listing: doc });
      }
    }

    // Re-rank by closeness to the typed string before slicing: Typesense's
    // typo-tolerant order otherwise floats lookalikes (right civic number/wrong
    // street, or a shared street-name word) above the typed address.
    const rankedAddresses = rankAddressSuggestions(q, addresses, (a) => a.label);
    out.push(...rankedAddresses.slice(0, 4), ...places.slice(0, 6));
  }

  if (out.length === 0) {
    return searchCities(q)
      .slice(0, 8)
      .map((c) => ({ kind: 'city' as const, label: c.name }));
  }

  return out.slice(0, 8);
}

/**
 * Places-only typeahead (city / neighbourhood). Thin wrapper over suggestSearch,
 * retained for the dashboard config panel which only picks markets, not listings.
 */
export interface LocationSuggestion {
  label: string;
  kind: 'city' | 'neighbourhood';
  count?: number;
}

export async function suggestLocations(query: string): Promise<LocationSuggestion[]> {
  const results = await suggestSearch(query);
  return results
    .filter((s) => s.kind === 'city' || s.kind === 'neighbourhood')
    .map((s) => ({ label: s.label, kind: s.kind as 'city' | 'neighbourhood', count: s.count }));
}

/**
 * Search with geospatial bounding box
 * Optimized for map viewport queries
 */
export async function searchListingsInBounds(
  bounds: { north: number; south: number; east: number; west: number },
  options: Partial<SearchOptions> = {}
): Promise<SearchResult> {
  return searchListings({
    ...options,
    query: options.query || '*',
    filters: {
      ...options.filters,
      boundingBox: bounds
    }
  });
}

/**
 * Index a single listing (for ETL worker)
 */
export async function indexListing(listing: ListingDocument): Promise<void> {
  const client = getTypesenseClient();
  
  // Omit optional fields that are null/undefined (Typesense requirement)
  const document: Record<string, unknown> = {
    id: listing.id,
    ListPrice: listing.ListPrice,
    isDistressed: listing.isDistressed,
    hasSecondarySuitePotential: listing.hasSecondarySuitePotential,
    location: listing.location
  };
  
  // Add optional fields only if they have values
  if (listing.UnparsedAddress) document.UnparsedAddress = listing.UnparsedAddress;
  if (listing.City) document.City = listing.City;
  if (listing.BedroomsTotal !== undefined) document.BedroomsTotal = listing.BedroomsTotal;
  if (listing.BathroomsTotalInteger !== undefined) document.BathroomsTotalInteger = listing.BathroomsTotalInteger;
  if (listing.PropertySubType) document.PropertySubType = listing.PropertySubType;
  if (listing.PropertyType) document.PropertyType = listing.PropertyType;
  if (listing.TransactionType) document.TransactionType = listing.TransactionType;
  if (listing.TaxAnnualAmount !== undefined) document.TaxAnnualAmount = listing.TaxAnnualAmount;
  if (listing.AssociationFee !== undefined) document.AssociationFee = listing.AssociationFee;
  if (listing.LotWidth !== undefined) document.LotWidth = listing.LotWidth;
  if (listing.LotDepth !== undefined) document.LotDepth = listing.LotDepth;
  if (listing.ApproximateAge) document.ApproximateAge = listing.ApproximateAge;
  if (listing.ParkingTotal !== undefined) document.ParkingTotal = listing.ParkingTotal;
  if (listing.BuildingAreaTotal !== undefined) document.BuildingAreaTotal = listing.BuildingAreaTotal;
  if (listing.LivingAreaRange) document.LivingAreaRange = listing.LivingAreaRange;
  // Size bounds: honour explicit values, otherwise derive from the two fields above.
  // Deriving here means a caller that forgets them still produces a filterable doc,
  // rather than one that silently vanishes from every size query.
  {
    const s =
      listing.sqft_min !== undefined && listing.sqft_max !== undefined
        ? { lo: listing.sqft_min, hi: listing.sqft_max }
        : sqftBoundsFor(listing);
    document.sqft_min = s.lo;
    document.sqft_max = s.hi;
  }
  if (listing.calculatedDOM !== undefined) document.calculatedDOM = listing.calculatedDOM;
  if (listing.thumbnailUrl) document.thumbnailUrl = listing.thumbnailUrl;
  if (listing.ListOfficeName) document.ListOfficeName = listing.ListOfficeName;
  
  await client.collections('properties').documents().upsert(document);
}

/**
 * Delete a listing from index
 */
export async function deleteListing(id: string): Promise<void> {
  const client = getTypesenseClient();
  await client.collections('properties').documents(id).delete();
}

/**
 * Health check
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const client = getTypesenseClient();
    await client.health.retrieve();
    return true;
  } catch {
    return false;
  }
}