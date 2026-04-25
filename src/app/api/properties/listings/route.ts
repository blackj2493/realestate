import { NextRequest, NextResponse } from "next/server";
import { ProptXClient } from "@/lib/proptx/client";
import type { PropertyResponse, MediaResponse } from "@/lib/proptx/types";
import { shouldIncludeProperty } from "@/lib/propertyTypes";
import { loadPostalCodes, getCoordinates } from "@/lib/postalCodes";

// Load postal codes at startup (once per server instance)
let postalCodesInitialized = false;
function ensurePostalCodesLoaded() {
  if (!postalCodesInitialized) {
    loadPostalCodes();
    postalCodesInitialized = true;
  }
}

export const dynamic = "force-dynamic";

// Basement filter value mappings to API values
const BASEMENT_FILTER_MAP: Record<string, string[]> = {
  finished: ['Finished', 'Partially Finished', 'Apartment'],
  walkout: ['Separate Entrance', 'Walk-Out', 'Walk-Up', 'Finished with Walk-Out'],
  unfinished: ['Unfinished', 'Full', 'Half', 'Partial Basement', 'Other'],
  none: ['None', 'Crawl Space'],
};

export async function GET(request: NextRequest) {
  // Ensure postal codes are loaded at startup
  ensurePostalCodesLoaded();
  
  const searchParams = request.nextUrl.searchParams;
  const city = searchParams.get("city");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = (page - 1) * limit;
  
  // Listing type filter (residential vs commercial) - defaults to residential
  const listingType = (searchParams.get("listingType") || "residential") as "residential" | "commercial";
  
  // Transaction type filter (buy vs rent) - defaults to buy (For Sale)
  const transactionType = (searchParams.get("type") || "buy") as "buy" | "rent";

  // Build filter from query params
  const filters: string[] = [];

  // City filter
  if (city) {
    filters.push(`contains(City,'${city}')`);
  }

  // Transaction Type filter: buy = "For Sale", rent = "For Lease"
  if (transactionType === "buy") {
    filters.push(`TransactionType eq 'For Sale'`);
  } else if (transactionType === "rent") {
    filters.push(`TransactionType eq 'For Lease'`);
  }

  // Price filters
  const minPrice = searchParams.get("minPrice");
  const maxPrice = searchParams.get("maxPrice");
  if (minPrice) filters.push(`ListPrice ge ${minPrice}`);
  if (maxPrice) filters.push(`ListPrice le ${maxPrice}`);

  // Bedroom filter (BedroomsAboveGrade)
  const bedroomsAboveGrade = searchParams.get("BedroomsAboveGrade");
  if (bedroomsAboveGrade && bedroomsAboveGrade !== "Any" && bedroomsAboveGrade !== "0") {
    filters.push(`BedroomsAboveGrade ge ${bedroomsAboveGrade}`);
  }

  // Bathroom filter
  const bathrooms = searchParams.get("BathroomsTotalInteger");
  if (bathrooms && bathrooms !== "Any" && bathrooms !== "0") {
    filters.push(`BathroomsTotalInteger ge ${bathrooms}`);
  }

  // Garage filter - values: "1" for must have garage, "0" for no garage
  const coveredSpaces = searchParams.get("CoveredSpaces");
  if (coveredSpaces) {
    if (coveredSpaces === "0") {
      filters.push(`CoveredSpaces eq 0`);
    } else {
      filters.push(`CoveredSpaces ge ${coveredSpaces}`);
    }
  }

  // Basement filter - passed through to be applied post-API (array field handling)
  // We collect this but apply filtering in the response transformation
  const basementFilterParam = searchParams.get("Basement");
  

  // Lot size filter
  const lotMin = searchParams.get("LotMin");
  const lotMax = searchParams.get("LotMax");
  const lotUnit = searchParams.get("LotUnit");

  if (lotMin || lotMax) {
    if (lotUnit === "acres") {
      // API uses LotSizeArea which might be in acres or square feet
      // Also we have LotSizeRangeAcres for pre-calculated ranges
      if (lotMin) {
        // Convert acres to square feet for comparison (1 acre = 43560 sq ft)
        const minSqFt = parseFloat(lotMin) * 43560;
        filters.push(`LotSizeArea ge ${minSqFt}`);
      }
      if (lotMax) {
        const maxSqFt = parseFloat(lotMax) * 43560;
        filters.push(`LotSizeArea le ${maxSqFt}`);
      }
    } else {
      // Square feet
      if (lotMin) {
        filters.push(`LotSizeArea ge ${lotMin}`);
      }
      if (lotMax) {
        filters.push(`LotSizeArea le ${lotMax}`);
      }
    }
  }

  // Association Fee filter (maximum)
  const maxAssociationFee = searchParams.get("MaxAssociationFee");
  if (maxAssociationFee) {
    filters.push(`AssociationFee le ${maxAssociationFee}`);
  }

  // Annual Taxes filter (maximum)
  const maxAnnualTaxes = searchParams.get("MaxAnnualTaxes");
  if (maxAnnualTaxes) {
    filters.push(`TaxAnnualAmount le ${maxAnnualTaxes}`);
  }

  // Days on Market filter (minimum)
  const minDaysOnMarket = searchParams.get("MinDaysOnMarket");
  if (minDaysOnMarket) {
    filters.push(`DaysOnMarket ge ${minDaysOnMarket}`);
  }

  // Property type filters
  const propertyType = searchParams.get("PropertyType");
  if (propertyType && propertyType !== "All") {
    filters.push(`PropertyType eq '${propertyType}'`);
  }

  const propertySubType = searchParams.get("PropertySubType");
  if (propertySubType && propertySubType !== "All") {
    filters.push(`PropertySubType eq '${propertySubType}'`);
  }

  try {
    const vowToken = process.env.PROPTX_VOW_TOKEN;
    if (!vowToken) {
      return NextResponse.json(
        { error: "API token not configured" },
        { status: 500 }
      );
    }

    const client = new ProptXClient(vowToken, "VOW");

    // Build filter string
    const filterString = filters.length > 0 ? filters.join(" and ") : undefined;

    // Fetch properties with pagination
    const properties: PropertyResponse = await client.getProperties({
      $top: limit,
      $skip: offset,
      $filter: filterString,
      $count: true,
    } as any);

    // Get listing keys for media fetch
    const listingKeys = properties.value.map(p => p.ListingKey);
    
    // Fetch media for all properties
    let mediaMap: Map<string, string> = new Map();
    
    if (listingKeys.length > 0) {
      for (const listingKey of listingKeys) {
        try {
          const mediaResponse: MediaResponse = await client.getMedia(listingKey);
          
          for (const media of mediaResponse.value) {
            if (!media.MediaURL) continue;
            
            // Skip non-public media and deleted media
            if (media.MediaStatus === 'Deleted') continue;
            if (media.Permission && Array.isArray(media.Permission) && !media.Permission.includes('Public')) continue;
            
            const existingUrl = mediaMap.get(listingKey);
            // Prefer Large images over smaller ones
            const currentPreferred = existingUrl && existingUrl.includes('ImageSizeDescription=Large');
            const thisIsLarge = media.ImageSizeDescription === 'Large';
            
            if (!existingUrl || (thisIsLarge && !currentPreferred)) {
              mediaMap.set(listingKey, media.MediaURL);
            }
          }
        } catch (mediaError) {
          console.warn(`Error fetching media for ${listingKey}:`, mediaError);
        }
      }
    }

    // Debug: Check mediaMap
    console.log('MediaMap debug - Keys with images:', 
      Array.from(mediaMap.entries()).filter(([k, v]) => v).slice(0, 3)
        .map(([k, v]) => ({ key: k, hasUrl: !!v }))
    );

    // Transform properties and filter by listing type (residential vs commercial)
    let listings = properties.value
      .map((property) => {
        const photoUrl = mediaMap.get(property.ListingKey);
        
        // Get coordinates from postal code lookup (tiered: exact match → FSA fallback)
        const postalCodeCoords = getCoordinates(property.PostalCode);
        const latitude = property.Latitude || postalCodeCoords?.lat || null;
        const longitude = property.Longitude || postalCodeCoords?.lng || null;
        
        return {
          ListingKey: property.ListingKey,
          ListingId: property.ListingId || property.ListingKey,
          ListPrice: property.ListPrice,
          PreviousListPrice: property.PreviousListPrice,
          UnparsedAddress: property.UnparsedAddress,
          StreetNumber: property.StreetNumber,
          StreetName: property.StreetName,
          City: property.City,
          StateOrProvince: property.StateOrProvince,
          PostalCode: property.PostalCode,
          PropertyType: property.PropertyType,
          PropertySubType: property.PropertySubType,
          TransactionType: property.TransactionType,
          BedroomsTotal: property.BedroomsTotal,
          BedroomsAboveGrade: property.BedroomsAboveGrade,
          BedroomsBelowGrade: property.BedroomsBelowGrade,
          BathroomsTotalInteger: property.BathroomsTotalInteger,
          BuildingAreaTotal: property.BuildingAreaTotal,
          ParkingTotal: property.ParkingTotal,
          CoveredSpaces: property.CoveredSpaces,
          DaysOnMarket: property.DaysOnMarket,
          ListOfficeName: property.ListOfficeName,
          StandardStatus: property.StandardStatus,
          PublicRemarks: property.PublicRemarks,
          OriginalEntryTimestamp: property.OriginalEntryTimestamp,
          TaxAnnualAmount: property.TaxAnnualAmount,
          AssociationFee: property.AssociationFee,
          LotSizeArea: property.LotSizeArea,
          LotSizeUnits: property.LotSizeUnits,
          LotWidth: property.LotWidth,
          LotDepth: property.LotDepth,
          Basement: property.Basement,
          // Use API coordinates if available, otherwise fallback to postal code lookup
          Latitude: latitude,
          Longitude: longitude,
          // Add media URL
          photoUrl: photoUrl || null,
          images: photoUrl 
            ? [{ MediaURL: photoUrl, MediaCategory: 'Photo', Order: 0 }]
            : [],
          // Legacy/compatibility fields
          media: photoUrl
            ? [{ MediaURL: photoUrl, MediaCategory: 'Photo' }]
            : [],
        };
      })
      .filter(p => shouldIncludeProperty(p.PropertySubType, listingType));
    
    // Apply basement filter in JavaScript (post-API filtering for array field)
    if (basementFilterParam && basementFilterParam.length > 0) {
      const selected = basementFilterParam.split(",").map(s => s.trim());
      const apiValues: string[] = [];
      
      for (const key of selected) {
        if (BASEMENT_FILTER_MAP[key]) {
          apiValues.push(...BASEMENT_FILTER_MAP[key]);
        }
      }
      
      if (apiValues.length > 0) {
        const beforeCount = listings.length;
        listings = listings.filter(property => {
          const basement = property.Basement;
          if (!basement || !Array.isArray(basement)) return false;
          // Check if ANY basement value matches
          return basement.some(b => apiValues.includes(b));
        });
        console.log(`Basement filter: ${beforeCount} -> ${listings.length} properties`);
      }
    }

    const totalCount = (properties as any)['@odata.count'] || properties.value.length;

    return NextResponse.json({
      listings,
      pagination: {
        page,
        limit,
        total: totalCount,
        hasMore: offset + listings.length < totalCount,
      },
    });
  } catch (error) {
    console.error("Error fetching properties:", error);
    return NextResponse.json(
      { error: "Failed to fetch properties", details: (error as Error).message },
      { status: 500 }
    );
  }
}