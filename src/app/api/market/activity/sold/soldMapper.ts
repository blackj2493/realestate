/** Pure shape + mapper for sold rows — kept out of route.ts so node-env tests don't load next/server. */

export interface SoldListing {
  id: string;
  address: string;
  closePrice: number;
  listPrice: number | null;
  soldDate: string | null;
  propertySubType: string | null;
  beds: number | null;
  bedsAbove: number | null;
  bedsBelow: number | null;
  baths: number | null;
  sqft: number | null;
  brokerage: string | null;
  city: string | null;
  /** Best-fit thumbnail URL (selectPrimaryImage), null when no usable VOW media. */
  primaryImageUrl: string | null;
  /** Latitude/longitude for map pins; null when the postal code didn't resolve. */
  lat: number | null;
  lng: number | null;
  /** 'sold' | 'leased' | de-list reason — real-values deal type from the index. */
  dealType: "sold" | "leased" | "terminated" | "expired" | "suspended";
  /** Days the campaign survived (de-listed rows). */
  daysOnMarket: number | null;
  /** Original ask of a failed campaign (de-listed rows). */
  originalListPrice: number | null;
}

export const posOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Map a raw `sold_listings` document to the API's `SoldListing` shape. */
export function mapSoldDoc(d: Record<string, unknown>): SoldListing {
  const ms = Number(d.PurchaseContractDate);
  const loc = Array.isArray(d.location) ? (d.location as number[]) : null;
  return {
    id: String(d.id ?? ""),
    address: (d.UnparsedAddress as string) || "",
    closePrice: Number(d.ClosePrice) || 0,
    listPrice: posOrNull(d.ListPrice),
    soldDate: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
    propertySubType: (d.PropertySubType as string) || null,
    beds: posOrNull(d.BedroomsTotal),
    bedsAbove: posOrNull(d.BedroomsAboveGrade),
    bedsBelow: posOrNull(d.BedroomsBelowGrade),
    baths: posOrNull(d.BathroomsTotalInteger),
    sqft: posOrNull(d.BuildingAreaTotal),
    brokerage: (d.ListOfficeName as string) || null,
    city: (d.City as string) || null,
    primaryImageUrl: (d.primaryImageUrl as string) || null,
    lat: loc && Number.isFinite(loc[0]) ? loc[0] : null,
    lng: loc && Number.isFinite(loc[1]) ? loc[1] : null,
    dealType: (["leased", "terminated", "expired", "suspended"] as const).find(
      (v) => d.DealType === v
    ) ?? "sold",
    daysOnMarket: posOrNull(d.DaysOnMarket),
    originalListPrice: posOrNull(d.OriginalListPrice),
  };
}
