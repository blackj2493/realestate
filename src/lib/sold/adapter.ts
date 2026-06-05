/**
 * Adapt a VOW `SoldListing` (server sold route) into the `ListingDocument` shape the
 * terminal's map + ledger + popup already render. We reuse those surfaces rather than
 * build parallel ones; `ListingCardBody` branches on `IsSoldComp` to show the sold
 * layout (sold price, over/under-ask, sold date). ListPrice carries the SOLD price so
 * the map pin shows what it sold for; OriginalListPrice carries the ask for the delta.
 */
import type { ListingDocument } from "@/lib/typesense/client";
import type { SoldListing } from "@/app/api/market/activity/sold/soldMapper";

export function soldToListingDocument(s: SoldListing): ListingDocument {
  const hasCoords = s.lat != null && s.lng != null;
  return {
    id: s.id,
    ListPrice: s.closePrice,
    OriginalListPrice: s.listPrice ?? undefined,
    UnparsedAddress: s.address || undefined,
    City: s.city ?? undefined,
    PropertySubType: s.propertySubType ?? undefined,
    BedroomsTotal: s.beds ?? undefined,
    BathroomsTotalInteger: s.baths ?? undefined,
    BuildingAreaTotal: s.sqft ?? undefined,
    ListOfficeName: s.brokerage ?? undefined,
    primaryImageUrl: s.primaryImageUrl ?? undefined,
    thumbnailUrl: s.primaryImageUrl ?? undefined,
    // [lat, lng] per ListingDocument.location; [0,0] for ungeocoded rows (map filters them).
    location: hasCoords ? [s.lat as number, s.lng as number] : [0, 0],
    IsSoldComp: true,
    compKind: s.dealType,
    SoldDate: s.dealType === "sold" ? (s.soldDate ?? undefined) : undefined,
    LeasedDate: s.dealType === "leased" ? (s.soldDate ?? undefined) : undefined,
    // Discriminators consumed by render paths; sold comps carry no active-only metrics.
    isDistressed: false,
    hasSecondarySuitePotential: false,
  };
}
