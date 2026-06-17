/**
 * Adapt a VOW `SoldListing` (server sold route) into the `ListingDocument` shape the
 * terminal's map + ledger + popup already render. We reuse those surfaces rather than
 * build parallel ones; `ListingCardBody` branches on `IsSoldComp` to show the sold
 * layout (sold price, over/under-ask, sold date). ListPrice carries the SOLD price so
 * the map pin shows what it sold for; OriginalListPrice carries the ask for the delta.
 *
 * De-listed mapping: ListPrice = last ask (the price the market rejected — there is no
 * close price). OriginalListPrice = the opening ask. DelistedDate tracks when the
 * campaign ended; DaysOnMarket records how long it survived.
 */
import type { ListingDocument } from "@/lib/typesense/client";
import type { SoldListing } from "@/app/api/market/activity/sold/soldMapper";
import { isDelistedDealType } from "./dealType";

export function soldToListingDocument(s: SoldListing): ListingDocument {
  const hasCoords = s.lat != null && s.lng != null;
  const delisted = isDelistedDealType(s.dealType);
  return {
    id: s.id,
    // De-listed: the LAST ASK (the price the market rejected) — there is no
    // close price. Sold/leased: the close price, as before.
    ListPrice: delisted ? (s.listPrice ?? 0) : s.closePrice,
    OriginalListPrice: delisted ? (s.originalListPrice ?? undefined) : (s.listPrice ?? undefined),
    UnparsedAddress: s.address || undefined,
    City: s.city ?? undefined,
    PropertySubType: s.propertySubType ?? undefined,
    BedroomsTotal: s.beds ?? undefined,
    // Carry the above/below-grade split so the card renders "4+2" like the active
    // listings, ForSaleComp/SoldComp cards and the detail page — not the inflated
    // total. bedsLabel() falls back to BedroomsTotal when the split is absent
    // (~63% of legacy sold docs omit it).
    BedroomsAboveGrade: s.bedsAbove ?? undefined,
    BedroomsBelowGrade: s.bedsBelow ?? undefined,
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
    DelistedDate: delisted ? (s.soldDate ?? undefined) : undefined,
    DaysOnMarket: delisted ? (s.daysOnMarket ?? undefined) : undefined,
    // Discriminators consumed by render paths; sold comps carry no active-only metrics.
    isDistressed: false,
    hasSecondarySuitePotential: false,
  };
}
