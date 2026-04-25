import { NextRequest, NextResponse } from "next/server";
import { ProptXClient } from "@/lib/proptx/client";
import type { PropertyResponse, MediaResponse } from "@/lib/proptx/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const listingKey = resolvedParams.id;

  try {
    const vowToken = process.env.PROPTX_VOW_TOKEN;
    if (!vowToken) {
      return NextResponse.json(
        { error: "API token not configured" },
        { status: 500 }
      );
    }

    const client = new ProptXClient(vowToken, "VOW");

    // Fetch property details
    let property: PropertyResponse;
    try {
      property = await client.getProperties({
        $filter: `ListingKey eq '${listingKey}'`,
        $top: 1,
      });
    } catch (error) {
      // Fallback: try fetching by exact key
      try {
        const singleProperty = await client.getProperty(listingKey);
        property = { value: [singleProperty] };
      } catch {
        return NextResponse.json(
          { error: "Property not found" },
          { status: 404 }
        );
      }
    }

    if (!property.value || property.value.length === 0) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 }
      );
    }

    const prop = property.value[0];

    // Fetch media for this listing
    // Note: VOW token may have limited media access, try IDX token as fallback
    let media: MediaResponse = { value: [] };
    let mediaFetchMethod = 'VOW';
    
    try {
      media = await client.getMedia(listingKey);
      console.log(`[Media Debug] VOW token returned ${media.value?.length || 0} items`);
    } catch (mediaError) {
      console.warn("Error fetching media with VOW:", mediaError);
      
      // Try IDX token as fallback for media
      const idxToken = process.env.PROPTX_IDX_TOKEN;
      if (idxToken) {
        try {
          const idxClient = new ProptXClient(idxToken, "IDX");
          media = await idxClient.getMedia(listingKey);
          mediaFetchMethod = 'IDX';
          console.log(`[Media Debug] IDX token returned ${media.value?.length || 0} items`);
        } catch (idxError) {
          console.warn("Error fetching media with IDX:", idxError);
        }
      }
    }
    
    // Debug: log first few media items if any
    if (media.value && media.value.length > 0) {
      console.log(`[Media Debug] Using ${mediaFetchMethod} token`);
      console.log('[Media Debug] First media item:', JSON.stringify(media.value[0], null, 2));
    }

    // Filter and deduplicate media:
    // 1. Only include Active media (or undefined status)
    // 2. Only include Public permission media
    // 3. Deduplicate by MediaObjectID (keep the largest size for each object)
    const filteredMedia = (media.value || [])
      .filter(m => {
        // Skip deleted media
        if (m.MediaStatus === 'Deleted') return false;
        // Skip private media
        if (m.Permission && Array.isArray(m.Permission) && !m.Permission.includes('Public')) return false;
        return true;
      })
      .sort((a, b) => {
        // Sort by order, then prefer larger images (Largest > Large > Medium > Thumbnail)
        const sizeOrder: Record<string, number> = { 'LargestNoWatermark': 5, 'Largest': 4, 'Large': 3, 'Medium': 2, 'Thumbnail': 1 };
        const aSize = sizeOrder[a.ImageSizeDescription || ''] || 0;
        const bSize = sizeOrder[b.ImageSizeDescription || ''] || 0;
        if (a.Order !== b.Order) return (a.Order || 0) - (b.Order || 0);
        return bSize - aSize;
      })
      .reduce((acc: any[], m) => {
        // Deduplicate by MediaObjectID - keep first (largest) occurrence
        if (!acc.find(existing => existing.MediaObjectID === m.MediaObjectID)) {
          acc.push(m);
        }
        return acc;
      }, []);
    
    console.log(`[Media Debug] After filtering: ${filteredMedia.length} unique media items`);

    // Fetch rooms if available
    let rooms: { value: any[] } = { value: [] };
    try {
      rooms = await client.getRooms(listingKey);
    } catch (roomsError) {
      console.warn("Error fetching rooms:", roomsError);
    }

    // Transform the response
    const propertyData = {
      ListingKey: prop.ListingKey,
      ListPrice: prop.ListPrice,
      City: prop.City,
      StateOrProvince: prop.StateOrProvince,
      BedroomsTotal: prop.BedroomsTotal,
      BathroomsTotalInteger: prop.BathroomsTotalInteger,
      ListOfficeName: prop.ListOfficeName,
      UnparsedAddress: prop.UnparsedAddress,
      Utilities: prop.Utilities,
      Water: prop.Water,
      ExteriorFeatures: prop.ExteriorFeatures,
      ParkingTotal: prop.ParkingTotal,
      ParkingType: prop.ParkingType,
      AnnualTaxes: prop.TaxAnnualAmount,
      AssociationFee: prop.AssociationFee,
      PublicRemarks: prop.PublicRemarks,
      TransactionType: prop.TransactionType,
      TaxAnnualAmount: prop.TaxAnnualAmount,
      Latitude: prop.Latitude,
      Longitude: prop.Longitude,
      PostalCode: prop.PostalCode,
      ArchitecturalStyle: prop.ArchitecturalStyle,
      Basement: prop.Basement,
      DirectionFaces: prop.DirectionFaces,
      OriginalEntryTimestamp: prop.OriginalEntryTimestamp,
      BedroomsAboveGrade: prop.BedroomsAboveGrade,
      BedroomsBelowGrade: prop.BedroomsBelowGrade,
      CoveredSpaces: prop.CoveredSpaces,
      KitchensTotal: prop.KitchensTotal,
      KitchensAboveGrade: prop.KitchensAboveGrade,
      KitchensBelowGrade: prop.KitchensBelowGrade,
      RoomsAboveGrade: prop.RoomsAboveGrade,
      RoomsBelowGrade: prop.RoomsBelowGrade,
      InteriorFeatures: prop.InteriorFeatures,
      ConstructionMaterials: prop.ConstructionMaterials,
      FoundationDetails: prop.FoundationDetails,
      Roof: prop.Roof,
      LotWidth: prop.LotWidth,
      LotDepth: prop.LotDepth,
      LotSizeUnits: prop.LotSizeUnits,
      LotSizeRangeAcres: prop.LotSizeRangeAcres,
      HeatType: prop.HeatType,
      HeatSource: prop.HeatSource,
      Sewer: prop.Sewer,
      Cooling: prop.Cooling,
      Heating: prop.Heating,
      ParkingFeatures: prop.ParkingFeatures,
      PropertyFeatures: prop.PropertyFeatures,
      CityRegion: prop.CityRegion,
      PropertySubType: prop.PropertySubType,
      StandardStatus: prop.StandardStatus,
      DaysOnMarket: prop.DaysOnMarket,
      images: filteredMedia.map(m => ({
        MediaURL: m.MediaURL,
        MediaCategory: m.MediaCategory,
        MediaObjectID: m.MediaObjectID,
        ImageSizeDescription: m.ImageSizeDescription,
        Order: m.Order || 0,
      })),
      media: filteredMedia.map(m => ({
        MediaURL: m.MediaURL,
        MediaCategory: m.MediaCategory,
        MediaObjectID: m.MediaObjectID,
        ImageSizeDescription: m.ImageSizeDescription,
      })),
      rooms: rooms.value.map(r => ({
        RoomKey: r.RoomKey,
        RoomType: r.RoomType,
        RoomLevel: r.RoomLevel,
        RoomDimensions: r.RoomDimensions,
        RoomFeatures: r.RoomFeatures,
        RoomLength: r.RoomLength,
        RoomWidth: r.RoomWidth,
      })),
    };

    return NextResponse.json({ property: propertyData });
  } catch (error) {
    console.error("Error fetching property:", error);
    return NextResponse.json(
      { error: "Failed to fetch property", details: (error as Error).message },
      { status: 500 }
    );
  }
}