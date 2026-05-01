/**
 * Shadow MLS - ETL Transformer
 * 
 * Data mutation and derived metrics computation engine.
 * Transforms raw ProptX API payloads into:
 * - supabasePayload: Full JSONB document for storage
 * - typesensePayload: Lean index document for search
 * 
 * Run: npx tsx scripts/worker/transformer.ts
 */

import { getServiceRoleClient } from '@/lib/supabase/client';
import { indexListing, deleteListing } from '@/lib/typesense/client';

// ============================================================================
// Configuration
// ============================================================================

const BASELINE_RENT = 1200;  // Monthly rent placeholder per bedroom
const FALLBACK_LAT = 43.6532;  // Toronto center latitude
const FALLBACK_LNG = -79.3832;  // Toronto center longitude

// Mock postal code to coordinate mapping (replace with full postal-codes.json lookup)
// Tier 1 of geospatial fallback chain
const postalMap: Record<string, { lat: number; lng: number }> = {
  'L6P2Z1': { lat: 43.785, lng: -79.652 },  // Brampton example
  'M5V3A1': { lat: 43.6425, lng: -79.3901 },  // Toronto downtown
  'L4W5A1': { lat: 43.6339, lng: -79.5831 },  // Mississauga
};

// ============================================================================
// Geospatial Resolution
// ============================================================================

interface GeolocationResult {
  location: [number, number];  // [lat, lng] for Typesense geopoint
  needsGeocoding: boolean;
}

/**
 * Resolves geolocation using strict fallback chain:
 * 1. Postal code local lookup
 * 2. API native coordinates
 * 3. Toronto center (with needsGeocoding flag)
 */
export function resolveLocation(
  postalCode: string | null | undefined,
  apiLat: number | null | undefined,
  apiLng: number | null | undefined
): GeolocationResult {
  // Tier 1: Postal code local lookup
  if (postalCode) {
    const normalized = postalCode.toUpperCase().replace(/\s/g, '');
    const coords = postalMap[normalized];
    if (coords) {
      return {
        location: [coords.lat, coords.lng],
        needsGeocoding: false
      };
    }
  }

  // Tier 2: API native coordinates
  if (apiLat !== null && apiLat !== undefined && 
      apiLng !== null && apiLng !== undefined) {
    return {
      location: [apiLat, apiLng],
      needsGeocoding: false
    };
  }

  // Tier 3: Fallback to Toronto center + flag for correction
  console.warn(`[Transformer] Location fallback triggered for postal: ${postalCode || 'unknown'}`);
  return {
    location: [FALLBACK_LAT, FALLBACK_LNG],
    needsGeocoding: true
  };
}

// ============================================================================
// Derived Metrics Engine
// ============================================================================

interface DerivedMetrics {
  calculatedDOM: number | null;
  targetGrossYield: number | null;
  isDistressed: boolean;
  hasSecondarySuitePotential: boolean;
}

/**
 * Calculates power-user persona metrics from raw listing data.
 */
export function calculateDerivedMetrics(raw: any): DerivedMetrics {
  // 1. Days on Market (calculatedDOM)
  let calculatedDOM: number | null = null;
  if (raw.OriginalEntryTimestamp) {
    const listingDate = new Date(raw.OriginalEntryTimestamp).getTime();
    const now = Date.now();
    calculatedDOM = Math.floor((now - listingDate) / (1000 * 60 * 60 * 24));
  }

  // 2. Target Gross Yield (for rental analysis)
  let targetGrossYield: number | null = null;
  if (raw.ListPrice && raw.ListPrice > 0) {
    const bedrooms = raw.BedroomsTotal || raw.BedroomsAboveGrade || 1;
    const annualRent = (bedrooms * BASELINE_RENT) * 12;
    targetGrossYield = annualRent / raw.ListPrice;
  }

  // 3. Is Distressed (regex on public remarks)
  let isDistressed = false;
  if (raw.PublicRemarks) {
    const remarksLower = raw.PublicRemarks.toLowerCase();
    const distressedPattern = /\b(as-is|tlc|handyman|contractor|renovator|estate)\b/;
    isDistressed = distressedPattern.test(remarksLower);
    
    // Also flag as distressed if DaysOnMarket > 90
    if (calculatedDOM !== null && calculatedDOM > 90) {
      isDistressed = true;
    }
    
    // Or if price has been reduced (PreviousListPrice exists and is higher)
    if (raw.PreviousListPrice && raw.ListPrice && raw.PreviousListPrice > raw.ListPrice) {
      const reductionPercent = ((raw.PreviousListPrice - raw.ListPrice) / raw.PreviousListPrice) * 100;
      if (reductionPercent > 5) {
        isDistressed = true;
      }
    }
  }

  // 4. Has Secondary Suite Potential
  let hasSecondarySuitePotential = false;
  
  // Check if multiple kitchens (strong indicator of multi-unit potential)
  const kitchensTotal = raw.KitchensTotal || 0;
  if (kitchensTotal > 1) {
    hasSecondarySuitePotential = true;
  }
  
  // Check basement status for suite potential
  if (raw.Basement && Array.isArray(raw.Basement)) {
    // Unfinished basement with separate entrance potential
    const basementValues = raw.Basement.map((b: string) => b.toLowerCase());
    if (
      basementValues.includes('unfinished') ||
      basementValues.includes('walk-out') ||
      basementValues.includes('separate entrance')
    ) {
      hasSecondarySuitePotential = true;
    }
  }

  return {
    calculatedDOM,
    targetGrossYield: targetGrossYield !== null ? Math.round(targetGrossYield * 1000) / 1000 : null,  // Round to 3 decimal places
    isDistressed,
    hasSecondarySuitePotential
  };
}

// ============================================================================
// Main Transform Function
// ============================================================================

export interface TransformResult {
  supabasePayload: {
    listing_key: string;
    full_payload: Record<string, unknown>;
    media_urls: string[];
    derived_metrics: DerivedMetrics;
    needs_geocoding: boolean;
    city: string | null;
    property_sub_type: string | null;
    list_price: number;
  };
  typesensePayload: {
    id: string;
    ListPrice: number;
    UnparsedAddress?: string;
    City?: string;
    BedroomsTotal?: number;
    BathroomsTotalInteger?: number;
    PropertySubType?: string;
    PropertyType?: string;
    location: [number, number];
    TransactionType?: string;
    TaxAnnualAmount?: number;
    AssociationFee?: number;
    LotWidth?: number;
    LotDepth?: number;
    ApproximateAge?: string;
    ParkingTotal?: number;
    BuildingAreaTotal?: number;
    isDistressed: boolean;
    targetGrossYield?: number;
    hasSecondarySuitePotential: boolean;
    calculatedDOM?: number;
    primaryImageUrl?: string;
    ListOfficeName?: string;
  };
}

/**
 * Transforms a raw ProptX API listing into dual storage payloads.
 * - supabasePayload: Full document for complete detail retrieval
 * - typesensePayload: Lean document for fast search/filter
 */
export function transformListing(raw: any): TransformResult {
  // Resolve geolocation with fallback chain
  const geo = resolveLocation(
    raw.PostalCode,
    raw.Latitude,
    raw.Longitude
  );

  // Calculate derived metrics
  const metrics = calculateDerivedMetrics(raw);

  // Extract media URLs for quick CDN access
  const mediaUrls: string[] = [];
  if (raw.media && Array.isArray(raw.media)) {
    raw.media.forEach((m: { MediaURL?: string; MediaStatus?: string }) => {
      if (m.MediaURL && m.MediaStatus !== 'Deleted') {
        mediaUrls.push(m.MediaURL);
      }
    });
  }
  if (raw.images && Array.isArray(raw.images)) {
    raw.images.forEach((m: { MediaURL?: string; MediaStatus?: string }) => {
      if (m.MediaURL && !mediaUrls.includes(m.MediaURL)) {
        mediaUrls.push(m.MediaURL);
      }
    });
  }

  // Build Supabase payload (full document)
  const supabasePayload = {
    listing_key: raw.ListingKey,
    full_payload: raw,  // Complete raw response
    media_urls: mediaUrls,
    derived_metrics: metrics,
    needs_geocoding: geo.needsGeocoding,
    city: raw.City || null,
    property_sub_type: raw.PropertySubType || null,
    list_price: raw.ListPrice || 0
  };

  // Build Typesense payload (lean document)
  // Omit optional fields if they are null/undefined (Typesense requirement)
  const typesensePayload: TransformResult['typesensePayload'] = {
    id: raw.ListingKey,
    ListPrice: raw.ListPrice || 0,
    location: geo.location,
    isDistressed: metrics.isDistressed,
    hasSecondarySuitePotential: metrics.hasSecondarySuitePotential
  };

  // Add optional fields only if they have values
  // FIX: Use parseFloat for fields that may contain decimal values from API
  if (raw.UnparsedAddress) typesensePayload.UnparsedAddress = raw.UnparsedAddress;
  if (raw.City) typesensePayload.City = raw.City;
  if (raw.BedroomsTotal !== undefined && raw.BedroomsTotal !== null) typesensePayload.BedroomsTotal = parseInt(String(raw.BedroomsTotal), 10);
  // FIX: BathroomsTotalInteger may come as float "14.5" from API - use parseFloat for type safety
  if (raw.BathroomsTotalInteger !== undefined && raw.BathroomsTotalInteger !== null) typesensePayload.BathroomsTotalInteger = parseFloat(String(raw.BathroomsTotalInteger));
  if (raw.PropertySubType) typesensePayload.PropertySubType = raw.PropertySubType;
  if (raw.PropertyType) typesensePayload.PropertyType = raw.PropertyType;
  if (raw.TransactionType) typesensePayload.TransactionType = raw.TransactionType;
  // FIX: TaxAnnualAmount is decimal - use parseFloat
  if (raw.TaxAnnualAmount !== undefined && raw.TaxAnnualAmount !== null) typesensePayload.TaxAnnualAmount = parseFloat(String(raw.TaxAnnualAmount));
  if (raw.AssociationFee !== undefined && raw.AssociationFee !== null) typesensePayload.AssociationFee = parseFloat(String(raw.AssociationFee));
  // FIX: LotWidth and LotDepth can be fractional - use parseFloat
  if (raw.LotWidth !== undefined && raw.LotWidth !== null) typesensePayload.LotWidth = parseFloat(String(raw.LotWidth));
  if (raw.LotDepth !== undefined && raw.LotDepth !== null) typesensePayload.LotDepth = parseFloat(String(raw.LotDepth));
  if (raw.ApproximateAge) typesensePayload.ApproximateAge = raw.ApproximateAge;
  if (raw.ParkingTotal !== undefined && raw.ParkingTotal !== null) typesensePayload.ParkingTotal = raw.ParkingTotal;
  if (raw.BuildingAreaTotal !== undefined && raw.BuildingAreaTotal !== null) typesensePayload.BuildingAreaTotal = raw.BuildingAreaTotal;
  if (metrics.targetGrossYield !== null) typesensePayload.targetGrossYield = metrics.targetGrossYield;
  if (metrics.calculatedDOM !== null) typesensePayload.calculatedDOM = metrics.calculatedDOM;
  if (mediaUrls.length > 0) typesensePayload.primaryImageUrl = mediaUrls[0];
  if (raw.ListOfficeName) typesensePayload.ListOfficeName = raw.ListOfficeName;

  return { supabasePayload, typesensePayload };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Test transformer with a mock listing
 */
export function testTransformer() {
  const mockListing = {
    ListingKey: 'MLS123456',
    ListPrice: 1250000,
    City: 'Brampton',
    PostalCode: 'L6P 2Z1',
    Latitude: null,
    Longitude: null,
    BedroomsTotal: 4,
    BathroomsTotalInteger: 3,
    PropertySubType: 'Detached',
    PropertyType: 'Residential',
    TransactionType: 'For Sale',
    OriginalEntryTimestamp: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),  // 45 days ago
    PublicRemarks: 'Beautiful family home, as-is sale. TLC needed for kitchen.',
    Basement: ['Unfinished', 'Walk-Out'],
    KitchensTotal: 2,
    TaxAnnualAmount: 6500,
    AssociationFee: 0,
    ListOfficeName: 'EXP Realty',
    media: [
      { MediaURL: 'https://example.com/photo1.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo2.jpg', MediaStatus: 'Active' }
    ]
  };

  console.log('\n🧪 Testing Transformer with mock listing:');
  console.log('Input:', JSON.stringify(mockListing, null, 2));
  
  const result = transformListing(mockListing);
  
  console.log('\n📦 Supabase Payload:');
  console.log(JSON.stringify(result.supabasePayload, null, 2));
  
  console.log('\n🔍 Typesense Payload:');
  console.log(JSON.stringify(result.typesensePayload, null, 2));
  
  console.log('\n✅ Transformer test complete!');
  return result;
}

// Run if executed directly
if (require.main === module) {
  testTransformer();
}