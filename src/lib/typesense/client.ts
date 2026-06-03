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

// Typesense configuration
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const SEARCH_API_KEY = process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY || 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj';

// Singleton client
let client: Client | null = null;

/**
 * Get Typesense client instance (singleton)
 */
export function getTypesenseClient(): Client {
  if (!client) {
    client = new Typesense.Client({
      nodes: [
        {
          host: TYPESENSE_HOST,
          port: TYPESENSE_PORT,
          protocol: 'https'
        }
      ],
      apiKey: SEARCH_API_KEY,
      connectionTimeoutSeconds: 30,
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

// ============================================================================
// Type Definitions (matches updated schema with camelCase fields)
// ============================================================================

export interface ListingDocument {
  id: string;  // Maps to ListingKey
  
  // Core Render Fields
  ListPrice: number;
  UnparsedAddress?: string;
  City?: string;
  
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
  
  // Derived Metrics
  isDistressed: boolean;
  targetGrossYield?: number;
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
  zoning_designation?: string;
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
  maxTaxes?: number;
  maxAssociationFee?: number;
  
  // Transaction
  transactionType?: 'For Sale' | 'For Lease';
  
  // Derived Metrics
  isDistressed?: boolean;
  hasSecondarySuitePotential?: boolean;
  minTargetGrossYield?: number;
  maxTargetGrossYield?: number;
  
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
    perPage = 20,
    sortBy,
    sortOrder = 'asc',
    rawFilterBy,
    geoPolygon,
    facetBy
  } = options;

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
  
  // Bedroom filter
  if (filters.minBedrooms !== undefined) {
    filterParts.push(`BedroomsTotal:>=${filters.minBedrooms}`);
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
  if (filters.maxTaxes !== undefined) {
    filterParts.push(`TaxAnnualAmount:<=${filters.maxTaxes}`);
  }
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
  
  // Target Gross Yield filter
  if (filters.minTargetGrossYield !== undefined) {
    filterParts.push(`targetGrossYield:>=${filters.minTargetGrossYield}`);
  }
  if (filters.maxTargetGrossYield !== undefined) {
    filterParts.push(`targetGrossYield:<=${filters.maxTargetGrossYield}`);
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
    searchParams.max_facet_values = 50;
  }

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
    const coords = geoPolygon.map(([lat, lng]) => `${lat}, ${lng}`).join(', ');
    const polyFilter = `location:(${coords})`;
    searchParams.filter_by = searchParams.filter_by
      ? `${searchParams.filter_by} && ${polyFilter}`
      : polyFilter;
  }

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
}

const SALES_FLOOR = 'ListPrice:>=100000';
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
    filter_by: SALES_FLOOR,
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

    out.push(...addresses.slice(0, 4), ...places.slice(0, 6));
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
 * Get nearby listings using geopoint
 * 
 * Typesense expects radius in KM, not meters
 * Format: location:(lat, lng, radius_in_km km)
 */
export async function getNearbyListings(
  lat: number,
  lng: number,
  radiusKm: number = 5,
  options: Partial<SearchOptions> = {}
): Promise<SearchResult> {
  const client = getTypesenseClient();

  // Typesense geo radius filter: location:(lat, lng, radius km)
  // Note: Typesense expects radius in km, NOT meters!
  const searchParams: Record<string, unknown> = {
    q: options.query || '*',
    query_by: 'City,CityRegion,PropertySubType',
    page: options.page || 1,
    per_page: options.perPage || 20,
    filter_by: `location:(${lat}, ${lng}, ${radiusKm} km)`,
    sort_by: 'calculatedDOM:asc'
  };
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client
      .collections('properties')
      .documents()
      .search(searchParams);
    
    return {
      listings: (response.hits || []).map((hit: { document: ListingDocument }) => hit.document),
      totalFound: response.found || 0,
      page: response.page || 1,
      perPage: options.perPage || 20,
      processingTimeMs: response.search_time_ms || 0
    };
  } catch (error) {
    console.error('[Typesense] Geo search error:', error);
    throw error;
  }
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
  if (listing.targetGrossYield !== undefined) document.targetGrossYield = listing.targetGrossYield;
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