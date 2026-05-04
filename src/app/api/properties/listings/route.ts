import { NextRequest, NextResponse } from "next/server";
import { searchListings, SearchFilters } from "@/lib/typesense/client";
import { loadPostalCodes, getCoordinates } from "@/lib/postalCodes";

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
  
  // Build filters for Typesense
  const filters: SearchFilters = {
    transactionType: transactionType === "buy" ? "For Sale" : "For Lease",
  };
  
  // DEBUG: Log all incoming search params
  console.log('[API] Search params:', Object.fromEntries(searchParams.entries()));
  
  // City filter
  const city = searchParams.get("city");
  if (city) {
    filters.city = city;
  }
  
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
    
    // Search using Typesense
    const result = await searchListings({
      query: '*',
      filters,
      page,
      perPage: limit,
    });
    
    // Transform to API response format with postal code lookup for coordinates
    // MLS doesn't send lat/lng, so we ALWAYS look up coordinates from postal code
    const transformedListings = result.listings.map((p) => {
      // Extract postal code from address and look up coordinates
      const address = p.UnparsedAddress || '';
      const postalCode = extractPostalCode(address);
      let lat: number | null = null;
      let lng: number | null = null;
      
      if (postalCode) {
        const coords = getCoordinates(postalCode);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
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