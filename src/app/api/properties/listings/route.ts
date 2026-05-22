import { NextRequest, NextResponse } from "next/server";
import { searchListings, SearchFilters } from "@/lib/typesense/client";
import { loadPostalCodes, getCoordinates, getCityCenter } from "@/lib/postalCodes";

export const dynamic = "force-dynamic";

// Initialize postal codes on startup
let postalCodesLoaded = false;
function ensurePostalCodesLoaded() {
  if (!postalCodesLoaded) {
    loadPostalCodes();
    postalCodesLoaded = true;
  }
}

// Extract postal code from address (e.g., "123 Main St, Toronto, ON M5V 3T6" -> "M5V 3T6")
function extractPostalCode(address: string): string | null {
  // Match Canadian postal code pattern: letter digit letter digit letter digit with optional space
  const match = address.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i);
  return match ? match[0].toUpperCase().replace(/\s+/, ' ') : null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  
  // Listing type filter (residential vs commercial)
  const listingType = searchParams.get("listingType") || "residential";
  
  // Transaction type filter (buy vs rent)
  const transactionType = searchParams.get("type") || "buy";
  
  // Build filters for Typesense (numeric/boolean filters only)
  const filters: SearchFilters = {
    transactionType: transactionType === "buy" ? "For Sale" : "For Lease",
  };
  
  // DEBUG: Log all incoming search params
  console.log('[API] Search params:', Object.fromEntries(searchParams.entries()));
  
  // NOTE: City filter removed - location search now uses full-text query instead
  // This handles TRREB casing inconsistencies (e.g., "BRAMPTON" vs "Brampton")
  
  // Price filters
  const minPrice = searchParams.get("minPrice");
  const maxPrice = searchParams.get("maxPrice");
  if (minPrice) filters.minPrice = parseFloat(minPrice);
  if (maxPrice) filters.maxPrice = parseFloat(maxPrice);
  
  // Bedroom filter
  const bedrooms = searchParams.get("BedroomsAboveGrade");
  if (bedrooms && bedrooms !== "Any" && bedrooms !== "0") {
    filters.minBedrooms = parseInt(bedrooms);
  }
  
  // Bathroom filter
  const bathrooms = searchParams.get("BathroomsTotalInteger");
  if (bathrooms && bathrooms !== "Any" && bathrooms !== "0") {
    filters.minBathrooms = parseInt(bathrooms);
  }
  
  // Days on Market filter
  const minDOM = searchParams.get("MinDaysOnMarket");
  if (minDOM) {
    filters.minDOM = parseInt(minDOM);
  }
  
  try {
    // Ensure postal codes are loaded
    ensurePostalCodesLoaded();
    
    // Get search query for full-text search (replaces strict city filter)
    // Uses 'search' param first, then falls back to 'city' param
    const searchQuery = searchParams.get("search") || searchParams.get("city") || "*";
    const query = searchQuery === "*" ? "*" : searchQuery;
    
    console.log('[API] Full-text query:', query);
    
    // Search using Typesense with full-text search
    const result = await searchListings({
      query: query,
      filters,
      page,
      perPage: limit,
    });
    
    // Transform to API response format with postal code lookup for coordinates
    // MLS doesn't send lat/lng, so we ALWAYS look up coordinates from postal code
    // Fallback to city center if postal code lookup fails
    const transformedListings = result.listings.map((p) => {
      // Extract postal code from address and look up coordinates
      const address = p.UnparsedAddress || '';
      const postalCode = extractPostalCode(address);
      const propertyCity = p.City || 'Unknown';
      let lat: number | null = null;
      let lng: number | null = null;
      
      if (postalCode) {
        // Normalize postal code: remove spaces to match data format (L6P2Z1 not L6P 2Z1)
        const normalizedPostal = postalCode.replace(/\s+/g, '');
        const coords = getCoordinates(normalizedPostal);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
      }
      
      // Fallback to city center if postal code lookup failed
      if (lat === null || lng === null) {
        const cityCoords = getCityCenter(propertyCity);
        if (cityCoords) {
          lat = cityCoords.lat;
          lng = cityCoords.lng;
        }
      }
      
      // DEBUG: Log coordinate resolution
      if (!lat || !lng) {
        console.log(`[API] Could not resolve coords for: ${address}, city: ${propertyCity}, postalCode: ${postalCode}`);
      } else {
        // Log sample coordinates for debugging (first 3 only)
        const idx = transformedListings.length;
        if (idx < 3) {
          console.log(`[API] Resolved coords #${idx + 1}: lat=${lat}, lng=${lng}, address=${address.substring(0, 50)}`);
        }
      }
      
      // Validate coordinates are in Canada (detect Ecuador-like issues)
      // Replace invalid coordinates with Toronto fallback
      const CANADA_BOUNDS = { minLat: 41, maxLat: 84, minLng: -141, maxLng: -53 };
      if (lat && lng && (lat < CANADA_BOUNDS.minLat || lat > CANADA_BOUNDS.maxLat || lng < CANADA_BOUNDS.minLng || lng > CANADA_BOUNDS.maxLng)) {
        console.warn(`[API] ⚠️ INVALID COORDS DETECTED: lat=${lat}, lng=${lng} for ${address} - using Toronto fallback`);
        // Replace with Toronto center fallback
        lat = 43.6532;
        lng = -79.3832;
      }
      
      return {
        ListingKey: p.id,
        ListPrice: p.ListPrice,
        UnparsedAddress: p.UnparsedAddress || 'Address Unavailable',
        City: p.City || 'Unknown',
        PropertyType: p.PropertyType,
        PropertySubType: p.PropertySubType,
        TransactionType: p.TransactionType,
        BedroomsTotal: p.BedroomsTotal || 0,
        BathroomsTotalInteger: p.BathroomsTotalInteger || 0,
        BuildingAreaTotal: p.BuildingAreaTotal,
        DaysOnMarket: p.calculatedDOM || 0,
        ListOfficeName: p.ListOfficeName,
        photoUrl: p.thumbnailUrl || null,
        primaryImageUrl: (p as { primaryImageUrl?: string }).primaryImageUrl || p.thumbnailUrl || null,
        Latitude: lat,
        Longitude: lng,
      };
    });
    
    return NextResponse.json({
      listings: transformedListings,
      pagination: {
        page,
        limit,
        total: result.totalFound,
        hasMore: page * limit < result.totalFound,
      },
    });
  } catch (error) {
    console.error("[API] Typesense search error:", error);
    return NextResponse.json(
      { error: "Search failed", details: (error as Error).message },
      { status: 500 }
    );
  }
}