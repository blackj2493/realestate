/**
 * Typesense Client Library
 * 
 * Provides typed search helpers for the Shadow MLS search layer.
 * Optimized for <30ms search responses with geospatial support.
 * 
 * Uses SEARCH_ONLY_API_KEY - read-only operations only.
 */

import Typesense, { Client } from 'typesense';

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
      connectionTimeoutSeconds: 5
    });
  }
  return client;
}

// ============================================================================
// Type Definitions (mirrors V1 schema)
// ============================================================================

export interface ListingDocument {
  id: string;  // Maps to ListingKey
  
  // Core Render Fields
  ListPrice: number;
  UnparsedAddress?: string;
  City?: string;
  
  // Property Specs
  BedroomsTotal?: number;
  BathroomsTotalInteger?: number;
  PropertySubType?: string;
  PropertyType?: string;
  
  // Geopoint: [latitude, longitude]
  location: [number, number];
  
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
  
  // Days on Market
  minDOM?: number;
  maxDOM?: number;
}

export interface SearchOptions {
  query: string;
  filters?: SearchFilters;
  page?: number;
  perPage?: number;
  sortBy?: string;  // Overrides default sort
  sortOrder?: 'asc' | 'desc';
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
    sortOrder = 'asc'
  } = options;
  
  // Build filter string
  const filterParts: string[] = [];
  
  // City filter
  if (filters.city) {
    filterParts.push(`City:${filters.city}`);
  }
  
  // Price filters
  if (filters.minPrice !== undefined) {
    filterParts.push(`ListPrice >= ${filters.minPrice}`);
  }
  if (filters.maxPrice !== undefined) {
    filterParts.push(`ListPrice <= ${filters.maxPrice}`);
  }
  
  // Bedroom filter
  if (filters.minBedrooms !== undefined) {
    filterParts.push(`BedroomsTotal >= ${filters.minBedrooms}`);
  }
  
  // Bathroom filter
  if (filters.minBathrooms !== undefined) {
    filterParts.push(`BathroomsTotalInteger >= ${filters.minBathrooms}`);
  }
  
  // Property SubType filter (multi-select)
  if (filters.propertySubTypes && filters.propertySubTypes.length > 0) {
    const subtypeFilter = filters.propertySubTypes
      .map(st => `PropertySubType:${st}`)
      .join(' || ');
    filterParts.push(`(${subtypeFilter})`);
  }
  
  // Property Type filter (multi-select)
  if (filters.propertyTypes && filters.propertyTypes.length > 0) {
    const typeFilter = filters.propertyTypes
      .map(pt => `PropertyType:${pt}`)
      .join(' || ');
    filterParts.push(`(${typeFilter})`);
  }
  
  // Financial filters
  if (filters.maxTaxes !== undefined) {
    filterParts.push(`TaxAnnualAmount <= ${filters.maxTaxes}`);
  }
  if (filters.maxAssociationFee !== undefined) {
    filterParts.push(`AssociationFee <= ${filters.maxAssociationFee}`);
  }
  
  // Transaction Type
  if (filters.transactionType) {
    filterParts.push(`TransactionType:${filters.transactionType}`);
  }
  
  // Derived metrics
  if (filters.isDistressed !== undefined) {
    filterParts.push(`isDistressed:=${filters.isDistressed}`);
  }
  if (filters.hasSecondarySuitePotential !== undefined) {
    filterParts.push(`hasSecondarySuitePotential:=${filters.hasSecondarySuitePotential}`);
  }
  
  // Days on Market
  if (filters.minDOM !== undefined) {
    filterParts.push(`calculatedDOM >= ${filters.minDOM}`);
  }
  if (filters.maxDOM !== undefined) {
    filterParts.push(`calculatedDOM <= ${filters.maxDOM}`);
  }
  
  // Build search params
  const searchParams: Record<string, unknown> = {
    q: query || '*',
    query_by: 'UnparsedAddress,City,PropertySubType',
    page,
    per_page: perPage,
    facet_by: 'City,PropertySubType,PropertyType,TransactionType,ApproximateAge,isDistressed,hasSecondarySuitePotential',
    max_facet_values: 50
  };
  
  // Apply filter string
  if (filterParts.length > 0) {
    searchParams.filter_by = filterParts.join(' && ');
  }
  
  // Custom sort
  if (sortBy) {
    searchParams.sort_by = `${sortBy}:${sortOrder}`;
  }
  
  // Geospatial bounding box
  if (filters.boundingBox) {
    const { south, west } = filters.boundingBox;
    searchParams.filter_by = searchParams.filter_by 
      ? `${searchParams.filter_by} && location:=[${south}, ${west}]`
      : `location:=[${south}, ${west}]`;
  }
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client
      .collections('listings')
      .documents()
      .search(searchParams);
    
    return {
      listings: (response.hits || []).map((hit: any) => hit.document as ListingDocument),
      totalFound: response.found || 0,
      page: response.page || page,
      perPage: perPage,
      processingTimeMs: response.search_time_ms || 0,
      facetDistribution: response.facet_distribution
    };
  } catch (error) {
    console.error('[Typesense] Search error:', error);
    throw error;
  }
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
 */
export async function getNearbyListings(
  lat: number,
  lng: number,
  radiusKm: number = 5,
  options: Partial<SearchOptions> = {}
): Promise<SearchResult> {
  const client = getTypesenseClient();
  
  // Typesense geopoint format: location:=[lat, lng, radius_in_m]
  const radiusMeters = radiusKm * 1000;
  
  const searchParams: Record<string, unknown> = {
    q: options.query || '*',
    query_by: 'UnparsedAddress,City,PropertySubType',
    page: options.page || 1,
    per_page: options.perPage || 20,
    filter_by: `location:=[${lat}, ${lng}, ${radiusMeters}]`,
    sort_by: 'calculatedDOM:asc'
  };
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client
      .collections('listings')
      .documents()
      .search(searchParams);
    
    return {
      listings: (response.hits || []).map((hit: any) => hit.document as ListingDocument),
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
  
  await client.collections('listings').documents().upsert(document);
}

/**
 * Delete a listing from index
 */
export async function deleteListing(id: string): Promise<void> {
  const client = getTypesenseClient();
  await client.collections('listings').documents(id).delete();
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
