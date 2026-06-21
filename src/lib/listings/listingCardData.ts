import type { ListingDocument } from "@/lib/typesense/client";
import type { PropertyCardData } from "@/components/PropertyCard";

/**
 * Map a Typesense ListingDocument → PropertyCardData for the server-rendered hub grids.
 * Shared by the city hubs and the investor hubs. Brokerage (ListOfficeName) is carried
 * through so every card satisfies TRREB §6.3(c). NOTE: never map proprietary/gated
 * metrics (cap rate, true DOM) onto the card — those stay behind the velvet rope.
 */
export function toCardData(doc: ListingDocument): PropertyCardData {
  return {
    id: doc.id,
    listingId: doc.id,
    address: doc.UnparsedAddress ?? "Address unavailable",
    city: doc.City ?? "",
    price: doc.ListPrice ?? 0,
    previousPrice: doc.OriginalListPrice,
    propertyType: doc.PropertySubType ?? doc.PropertyType ?? "",
    bedrooms: doc.BedroomsTotal ?? 0,
    bathrooms: doc.BathroomsTotalInteger ?? 0,
    squareFeet: doc.BuildingAreaTotal,
    daysOnMarket: doc.calculatedDOM,
    brokerage: doc.ListOfficeName,
    photoUrl: doc.thumbnailUrl ?? doc.primaryImageUrl ?? null,
    maintenance: doc.AssociationFee,
  };
}
