import { NextRequest, NextResponse } from "next/server";
import { ProptXClient } from "@/lib/proptx/client";
import type { PropertyResponse, MediaResponse } from "@/lib/proptx/types";
import { shouldIncludeProperty } from "@/lib/propertyTypes";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const city = searchParams.get("city");
  const postalCode = searchParams.get("postalCode");
  const limit = parseInt(searchParams.get("limit") || "12", 10);
  
  // Listing type filter (residential vs commercial) - defaults to residential
  const listingType = (searchParams.get("listingType") || "residential") as "residential" | "commercial";
  
  // Transaction type filter (buy vs rent) - defaults to buy (For Sale)
  const transactionType = (searchParams.get("type") || "buy") as "buy" | "rent";

  // Build filter array
  const filters: string[] = [];

  // Transaction Type filter: buy = "For Sale", rent = "For Lease"
  if (transactionType === "buy") {
    filters.push(`TransactionType eq 'For Sale'`);
  } else if (transactionType === "rent") {
    filters.push(`TransactionType eq 'For Lease'`);
  }

  try {
    // Get the VOW token from environment
    const vowToken = process.env.PROPTX_VOW_TOKEN;
    if (!vowToken) {
      return NextResponse.json(
        { error: "API token not configured" },
        { status: 500 }
      );
    }

    const client = new ProptXClient(vowToken, "VOW");
    let properties: PropertyResponse;

    // Build filter string from filters array
    let filterString = filters.length > 0 ? filters.join(" and ") : undefined;

    // Search by postal code prefix (e.g., "M5V") - most specific
    if (postalCode) {
      const postalFilter = `startswith(PostalCode,'${postalCode}')`;
      filterString = filterString 
        ? `(${filterString}) and ${postalFilter}` 
        : postalFilter;
    }
    // Search by city - use contains for partial matching
    else if (city) {
      const cityFilter = `contains(City,'${city}')`;
      filterString = filterString 
        ? `(${filterString}) and ${cityFilter}` 
        : cityFilter;
    } else {
      // Default: get properties in Toronto area
      const defaultFilter = `contains(City,'Toronto')`;
      filterString = filterString 
        ? `(${filterString}) and ${defaultFilter}` 
        : defaultFilter;
    }

    properties = await client.getProperties({
      $top: 50,
      $filter: filterString,
    });

    // Fetch media for all properties to get photos
    // Group listing keys for batch media queries
    const listingKeys = properties.value.map(p => p.ListingKey);
    // Use a map that tracks both URL and priority
    type MediaEntry = { url: string; priority: number };
    let mediaMap: Map<string, MediaEntry> = new Map();

    // Fetch media for properties in batches (API may have limits)
    const BATCH_SIZE = 10;
    for (let i = 0; i < listingKeys.length; i += BATCH_SIZE) {
      const batch = listingKeys.slice(i, i + BATCH_SIZE);
      const mediaFilters = batch.map(key => `ResourceRecordKey eq '${key}'`).join(' or ');
      
      try {
        const mediaResponse: MediaResponse = await client.getMediaBatch(mediaFilters);
        
        // Group media by listing key (prefer 'Largest' or 'Large' images)
        for (const media of mediaResponse.value) {
          const resourceKey = media.ResourceRecordKey;
          if (!resourceKey) continue;
          
          const currentSize = media.ImageSizeDescription;
          // Prefer Largest, then Large, then any available image (lower = better)
          const sizePriority = currentSize === 'Largest' ? 0 : currentSize === 'Large' ? 1 : 2;
          const existing = mediaMap.get(resourceKey);
          
          if (!existing || sizePriority < existing.priority) {
            mediaMap.set(resourceKey, { url: media.MediaURL, priority: sizePriority });
          }
        }
      } catch (mediaError) {
        console.warn("Error fetching media batch:", mediaError);
        // Continue without media for this batch
      }
    }

    // Transform properties and filter by listing type (residential vs commercial)
    let transformedProperties = properties.value
      .map((property) => ({
        id: property.ListingKey,
        listingId: property.ListingId || property.ListingKey,
        address: property.UnparsedAddress || 
          `${property.StreetNumber || ""} ${property.StreetName || ""}`.trim(),
        city: property.City || city || "Unknown",
        province: property.StateOrProvince || "ON",
        price: property.ListPrice || 0,
        previousPrice: property.PreviousListPrice,
        propertyType: property.PropertySubType || property.PropertyType || "Unknown",
        bedrooms: property.BedroomsTotal || 0,
        bathrooms: property.BathroomsTotalInteger || 0,
        squareFeet: property.BuildingAreaTotal || 0,
        daysOnMarket: property.DaysOnMarket || 0,
        brokerage: property.ListOfficeName || "Unknown",
        photoUrl: mediaMap.get(property.ListingKey)?.url ?? null,
        description: property.PublicRemarks?.substring(0, 200) || "",
        parkingSpaces: property.ParkingTotal || 0,
      }))
      // Filter based on listing type (residential/commercial)
      .filter(p => shouldIncludeProperty(p.propertyType, listingType))
      // Sort by days on market (newest first)
      .sort((a, b) => a.daysOnMarket - b.daysOnMarket)
      // Limit results
      .slice(0, limit);

    return NextResponse.json({
      properties: transformedProperties,
      total: transformedProperties.length,
      location: city || "Toronto",
    });
  } catch (error) {
    console.error("Error fetching nearby properties:", error);
    
    return NextResponse.json(
      { error: "Failed to fetch properties", details: (error as Error).message },
      { status: 500 }
    );
  }
}
