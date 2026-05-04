/**
 * Shadow MLS - Listing Transformation Utility (Phase 2)
 * 
 * Transforms raw IDX/VOW JSON from the ProptX board API into Typesense documents.
 * Built with robust fallbacks for messy real estate data.
 * 
 * This module handles:
 * - Type safety & null/undefined fallbacks
 * - Bathroom consolidation (BathroomsTotalInteger)
 * - Lot size standardization (acres → sqft, Width * Depth fallback)
 * - Media URL extraction
 * - Date conversion to Unix epoch
 * - Distress analysis (Phase 2)
 * - Eligibility filtering (Phase 2)
 */

import { TypesensePropertyDocument } from './typesenseSchema';
import { calculateDistress, DistressMetrics } from './DistressEngine';
import { evaluateEligibility, TerminalListing } from './EligibilityFilter';
import { calculateProForma, ProFormaMetrics } from './ExtrapolatedCapRateEngine';

// ============================================================================
// Constants
// ============================================================================

/**
 * Conversion factor: 1 acre = 43,560 square feet
 */
const SQFT_PER_ACRE = 43560;

/**
 * Fallback geolocation: Toronto center
 */
const FALLBACK_LAT = 43.6532;
const FALLBACK_LNG = -79.3832;

// ============================================================================
// Raw Payload Types (from ProptX VOW API)
// ============================================================================

/**
 * Raw listing payload structure from the ProptX board API.
 * Matches the Property interface from proptx/types.ts.
 */
export interface RawListingPayload {
  // Identity
  ListingKey?: string | null;
  ListingId?: string | null;
  MlsStatus?: string | null;
  StandardStatus?: string | null;
  
  // Property Classification
  PropertyType?: string | null;
  PropertySubType?: string | null;
  
  // Price
  ListPrice?: number | null;
  
  // Bedrooms / Bathrooms / Parking
  BedroomsTotal?: number | null;
  BathroomsTotalInteger?: number | null;
  ParkingTotal?: number | null;
  KitchensTotal?: number | null;
  
  // Location
  City?: string | null;
  CityRegion?: string | null;
  PostalCode?: string | null;
  
  // Basement
  Basement?: string[] | null;
  
  // Lot Dimensions
  LotSizeArea?: number | null;
  LotSizeUnits?: string | null;
  LotWidth?: number | null;
  LotDepth?: number | null;
  
  // Status & Age
  Status?: string | null;
  ApproximateAge?: string | null;
  
  // Dates
  OriginalEntryTimestamp?: string | null;
  
  // Coordinates
  Latitude?: number | null;
  Longitude?: number | null;
  
  // Financial
  TaxAnnualAmount?: number | null;
  AssociationFee?: number | null;
  
  // Text / Media
  PublicRemarks?: string | null;
  
  // Images (may come as 'media' array or 'images' array)
  media?: Array<{ MediaURL?: string | null; MediaStatus?: string | null }> | null;
  images?: Array<{ MediaURL?: string | null; MediaStatus?: string | null }> | null;
  
  // Rooms
  Rooms?: unknown[] | null;
  
  // Geopoint override (from postal code lookup)
  location?: [number, number] | null;
  
  // ─── Phase 4: Address Fields for Property Hash ────────────────────────────
  // Used for Entity Resolution (TemporalDistressEngine)
  StreetNumber?: string | null;
  StreetName?: string | null;
  UnitNumber?: string | null;
  UnparsedAddress?: string | null;
  
  // Allow any additional fields
  [key: string]: unknown;
}

// ============================================================================
// Transformation Functions
// ============================================================================

/**
 * Safely parses a numeric value, returning a fallback if invalid.
 * Handles: null, undefined, NaN, non-numeric strings.
 */
function safeNumber(value: unknown, fallback: number = 0): number {
  if (value === null || value === undefined) return fallback;
  
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  
  if (isNaN(num) || !isFinite(num)) return fallback;
  
  return Math.round(num); // Convert to int for int32 fields
}

/**
 * Safely parses a float value (for float fields like lot dimensions).
 */
function safeFloat(value: unknown, fallback: number = 0): number {
  if (value === null || value === undefined) return fallback;
  
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  
  if (isNaN(num) || !isFinite(num)) return fallback;
  
  return num;
}

/**
 * Safely parses a string value, returning null for empty/whitespace strings.
 */
function safeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  
  const str = String(value).trim();
  
  return str.length > 0 ? str : null;
}

/**
 * Extracts MediaURL strings from a media/images array.
 * Filters out deleted media and empty URLs.
 */
function extractMediaUrls(raw: RawListingPayload): string[] {
  const urls: Set<string> = new Set();
  
  // Process 'media' array
  if (raw.media && Array.isArray(raw.media)) {
    for (const item of raw.media) {
      if (item.MediaURL && item.MediaStatus !== 'Deleted') {
        const url = safeString(item.MediaURL);
        if (url) urls.add(url);
      }
    }
  }
  
  // Process 'images' array
  if (raw.images && Array.isArray(raw.images)) {
    for (const item of raw.images) {
      if (item.MediaURL && item.MediaStatus !== 'Deleted') {
        const url = safeString(item.MediaURL);
        if (url) urls.add(url);
      }
    }
  }
  
  return Array.from(urls);
}

/**
 * Standardizes lot size to square feet.
 * 
 * Priority chain:
 * 1. If LotSizeUnits is "Acres", multiply LotSizeArea by 43560
 * 2. If LotSizeUnits is "Feet" or empty, use LotSizeArea directly
 * 3. Fallback: LotWidth * LotDepth
 * 4. Final fallback: 0
 */
function standardizeLotSize(raw: RawListingPayload): number {
  const area = raw.LotSizeArea;
  const units = safeString(raw.LotSizeUnits);
  const width = raw.LotWidth;
  const depth = raw.LotDepth;
  
  // Tier 1: Check LotSizeArea with explicit unit handling
  if (area !== null && area !== undefined) {
    if (units === 'Acres' || units === 'acre' || units === 'acres') {
      // Convert acres to square feet
      return Math.round(area * SQFT_PER_ACRE);
    }
    
    // Default to using area as sqft (or if units is missing/empty)
    if (!units || units === 'Feet' || units === 'SQFT' || units === 'SqFt') {
      return Math.round(area);
    }
  }
  
  // Tier 2: Fallback to Width * Depth
  if (width !== null && width !== undefined && depth !== null && depth !== undefined) {
    if (width > 0 && depth > 0) {
      return Math.round(width * depth);
    }
  }
  
  // Tier 3: Return 0 if all methods failed
  return 0;
}

/**
 * Converts an ISO date string to Unix epoch milliseconds.
 * Returns 0 if conversion fails.
 */
function dateToEpoch(dateStr: unknown): number {
  if (!dateStr) return 0;
  
  try {
    const date = new Date(String(dateStr));
    
    if (isNaN(date.getTime())) return 0;
    
    return date.getTime();
  } catch {
    return 0;
  }
}

/**
 * Resolves geolocation from either explicit location or postal code lookup.
 * Returns [lat, lng] tuple for Typesense geopoint.
 */
function resolveLocation(raw: RawListingPayload): [number, number] {
  // Use explicit location if provided
  if (raw.location && Array.isArray(raw.location) && raw.location.length === 2) {
    const [lat, lng] = raw.location;
    if (typeof lat === 'number' && typeof lng === 'number') {
      return [lat, lng];
    }
  }
  
  // Use API coordinates if available
  const apiLat = raw.Latitude;
  const apiLng = raw.Longitude;
  
  if (apiLat !== null && apiLat !== undefined && 
      apiLng !== null && apiLng !== undefined) {
    return [apiLat, apiLng];
  }
  
  // Fallback to Toronto center
  return [FALLBACK_LAT, FALLBACK_LNG];
}

// ============================================================================
// Main Transformation Function
// ============================================================================

/**
 * Transforms a raw ProptX board API listing into a Typesense document.
 * 
 * This function is the foundation of the "Filterable Core" - it extracts
 * only the fields needed for UI sliders, toggles, and sort dropdowns,
 * while preserving unindexed cargo for UI rendering.
 * 
 * @param rawPayload - Raw JSON from ProptX VOW API
 * @returns TypesensePropertyDocument ready for indexing
 * 
 * @example
 * ```typescript
 * const raw = await fetchListing();
 * const document = mapToTypesense(raw);
 * await typesenseClient.collections('properties').documents().upsert(document);
 * ```
 */
export function mapToTypesense(rawPayload: RawListingPayload): TypesensePropertyDocument {
  // Extract media URLs early for both indexing and cargo
  const rawImages = extractMediaUrls(rawPayload);
  
  // Resolve geolocation
  const location = resolveLocation(rawPayload);
  
  // Standardize lot size
  const lotSqftTotal = standardizeLotSize(rawPayload);
  
  // ─── Phase 2: Distress Analysis ───────────────────────────────────────────
  // Calculate distress metrics from remarks, media count, and days on market
  const distressData: DistressMetrics = calculateDistress(rawPayload as any);
  
  // ─── Phase 2: Eligibility Filter ────────────────────────────────────────────
  // Build TerminalListing from raw payload for eligibility evaluation
  const eligibilityInput: TerminalListing = {
    propertyType: rawPayload.PropertyType,
    propertySubType: rawPayload.PropertySubType,
    sewer: null, // Sewer data not in standard payload - assume municipal if not present
    water: null, // Water data not in standard payload - assume municipal if not present
    basement: rawPayload.Basement || null,
    leasedLandFee: rawPayload.AssociationFee ?? null, // Use association fee as proxy (0 = freehold)
    lotDepth: rawPayload.LotDepth ?? null,
  };
  const eligibilityResult = evaluateEligibility(eligibilityInput);
  
  // ─── Phase 3: Extrapolated Cap Rate Calculation ───────────────────────────
  // Calculate Pro Forma metrics if listing is ADU/suite eligible
  // Only eligible properties get value-add cap rate; others get 0
  const hasSuitePotential = eligibilityResult.isUniversallyEligible;
  const burnRateInput = {
    listPrice: rawPayload.ListPrice ?? 0,
    taxAnnualAmount: rawPayload.TaxAnnualAmount ?? null,
    associationFee: rawPayload.AssociationFee ?? null,
  };
  const proFormaMetrics: ProFormaMetrics = hasSuitePotential 
    ? calculateProForma(rawPayload.ListPrice, burnRateInput)
    : { total_capital_basis: 0, pro_forma_noi: 0, extrapolated_cap_rate: 0, capital_burn_rate_monthly: 0 };
  
  // Build the document with all required fields and fallbacks
  const document: TypesensePropertyDocument = {
    // Identity
    id: safeString(rawPayload.ListingKey) || `unknown-${Date.now()}`,
    listing_key: safeString(rawPayload.ListingKey) || '',
    
    // Price
    list_price: safeNumber(rawPayload.ListPrice, 0),
    
    // Property Classification
    property_type: safeString(rawPayload.PropertyType),
    property_sub_type: safeString(rawPayload.PropertySubType),
    
    // Bedrooms / Bathrooms / Parking
    bedrooms: safeNumber(rawPayload.BedroomsTotal, 0),
    bathrooms: safeNumber(rawPayload.BathroomsTotalInteger, 0), // Consolidated bathrooms
    parking: safeNumber(rawPayload.ParkingTotal, 0),
    
    // Location
    city: safeString(rawPayload.City),
    city_region: safeString(rawPayload.CityRegion),
    postal_code: safeString(rawPayload.PostalCode),
    
    // Basement & Kitchens
    basement_type: Array.isArray(rawPayload.Basement) 
      ? rawPayload.Basement.map(b => safeString(b)).filter((b): b is string => b !== null)
      : [],
    kitchens: safeNumber(rawPayload.KitchensTotal, 0),
    
    // Lot Dimensions
    lot_width: safeFloat(rawPayload.LotWidth, 0),
    lot_depth: safeFloat(rawPayload.LotDepth, 0),
    lot_sqft_total: lotSqftTotal,
    
    // Status & Age
    status: safeString(rawPayload.MlsStatus) || safeString(rawPayload.StandardStatus),
    approx_age: safeString(rawPayload.ApproximateAge),
    
    // Timestamp (Unix epoch for fast sorting)
    entry_timestamp: dateToEpoch(rawPayload.OriginalEntryTimestamp),
    
    // Geolocation [lat, lng]
    location: location,
    
    // ─── Extrapolated Cap Rate (Phase 3) ────────────────────────────────────
    // Pro Forma metrics for value-add analysis
    total_capital_basis: proFormaMetrics.total_capital_basis,
    extrapolated_cap_rate: proFormaMetrics.extrapolated_cap_rate,
    capital_burn_rate_monthly: proFormaMetrics.capital_burn_rate_monthly,
    
    // ─── Temporal Distress (Phase 4) ──────────────────────────────────────
    // Placeholders - enriched by ETL pipeline (sync.ts) with True DOM calculation
    // These are computed via generatePropertyHash + calculateTrueDOM
    property_hash: '',
    true_dom: 0,
    total_price_drop: 0,
    
    // ─── ADU/Suite Potential (Phase 2) ──────────────────────────────────────
    // Distress Analysis
    distress_score: distressData.distress_score,
    distress_vectors: distressData.distress_vectors,
    is_financial_distress: distressData.is_financial_distress,
    is_physical_distress: distressData.is_physical_distress,
    
    // Eligibility Filter
    is_universally_eligible: eligibilityResult.isUniversallyEligible,
    universal_rejection_reason: eligibilityResult.universalRejectionReason,
    is_internal_eligible: eligibilityResult.isInternalEligible,
    internal_rejection_reason: eligibilityResult.internalRejectionReason,
    is_detached_eligible: eligibilityResult.isDetachedEligible,
    detached_rejection_reason: eligibilityResult.detachedRejectionReason,
    
    // ─── Unindexed Cargo ────────────────────────────────────────────────────
    // These fields are stored but NOT indexed (for UI rendering only)
    public_remarks: safeString(rawPayload.PublicRemarks),
    tax_annual: safeFloat(rawPayload.TaxAnnualAmount, 0),
    association_fee: safeFloat(rawPayload.AssociationFee, 0),
    raw_images: rawImages,
    raw_rooms: rawPayload.Rooms || null,
  };
  
  return document;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validates that a raw payload has the minimum required fields for indexing.
 * Returns an array of missing required fields (empty if valid).
 */
export function validateRawPayload(raw: RawListingPayload): string[] {
  const missing: string[] = [];
  
  if (!raw.ListingKey) {
    missing.push('ListingKey');
  }
  
  if (raw.ListPrice === null || raw.ListPrice === undefined) {
    missing.push('ListPrice');
  }
  
  return missing;
}

/**
 * Batch transform multiple listings.
 * Useful for ETL batch processing.
 */
export function mapBatchToTypesense(listings: RawListingPayload[]): TypesensePropertyDocument[] {
  return listings.map(mapToTypesense);
}

// ============================================================================
// Test & Dev Helpers
// ============================================================================

/**
 * Creates a mock raw payload for testing.
 */
export function createMockRawListing(overrides: Partial<RawListingPayload> = {}): RawListingPayload {
  return {
    ListingKey: 'TEST' + Date.now(),
    ListPrice: 850000,
    PropertyType: 'Residential',
    PropertySubType: 'Detached',
    BedroomsTotal: 4,
    BathroomsTotalInteger: 3,
    ParkingTotal: 2,
    KitchensTotal: 1,
    City: 'Brampton',
    CityRegion: 'Peel',
    PostalCode: 'L6P 2Z1',
    Basement: ['Finished', 'Walk-Up'],
    LotSizeArea: 0.23,
    LotSizeUnits: 'Acres',
    LotWidth: 45.0,
    LotDepth: 110.0,
    Status: 'Active',
    ApproximateAge: '11-15 Years',
    OriginalEntryTimestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    Latitude: 43.7309,
    Longitude: -79.7845,
    TaxAnnualAmount: 5800.00,
    AssociationFee: 0, // 0 = freehold (no leasehold fee that would trigger ADU rejection)
    PublicRemarks: 'Beautiful family home with updated kitchen and hardwood floors throughout. Walking distance to schools and parks.',
    media: [
      { MediaURL: 'https://example.com/photo1.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo2.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo3.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo4.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo5.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo6.jpg', MediaStatus: 'Active' },
    ],
    Rooms: [
      { RoomType: ['Living', 'Hardwood'], RoomLevel: 'Main' },
      { RoomType: ['Kitchen', 'Ceramic Floor'], RoomLevel: 'Main' },
    ],
    ...overrides,
  };
}
export function testTransform(): TypesensePropertyDocument {
  const mock = createMockRawListing();
  
  console.log('\n🧪 Shadow MLS Transformer Test');
  console.log('='.repeat(50));
  console.log('\n📥 Input (raw ProptX payload):');
  console.log(JSON.stringify(mock, null, 2));
  
  const result = mapToTypesense(mock);
  
  console.log('\n📤 Output (Typesense document):');
  console.log(JSON.stringify(result, null, 2));
  
  // Validate
  const validation = validateRawPayload(mock);
  if (validation.length === 0) {
    console.log('\n✅ Validation passed: All required fields present');
  } else {
    console.log(`\n⚠️  Validation failed: Missing fields: ${validation.join(', ')}`);
  }
  
  return result;
}

// Run if executed directly
if (require.main === module) {
  testTransform();
}

export default mapToTypesense;