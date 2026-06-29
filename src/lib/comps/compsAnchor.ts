/**
 * compsAnchorForListing — one definition of "comps for THIS home", shared by every
 * entry point (search-bar address row, map pin popup, ledger row). Constrains the
 * sold-comp view to the subject's property type + a ±30% price band — the same rule
 * the search-bar Comps pill established. Keeping it here means the entry points can't
 * drift apart.
 */
import type { ListingDocument } from "@/lib/typesense/client";
import { optionKeyForSubType } from "@/lib/property/similarListings";

/** ±band on the subject's price — wide enough for sparse areas, tight enough to drop a
 *  condo / an estate when the subject is a mid-market home. */
export const COMP_PRICE_BAND = 0.3;

export interface CompsAnchor {
  lat: number;
  lng: number;
  label?: string;
  types?: string[];
  minPrice?: number;
  maxPrice?: number;
}

/** Build the enterComps() payload from a listing, or null when it has no coordinates. */
export function compsAnchorForListing(l: ListingDocument): CompsAnchor | null {
  const loc = l.location;
  if (!Array.isArray(loc) || !(loc[0] || loc[1])) return null;
  const typeKey = optionKeyForSubType(l.PropertySubType ?? null);
  const price = l.ListPrice ?? 0;
  return {
    lat: loc[0],
    lng: loc[1],
    label: l.UnparsedAddress || undefined,
    types: typeKey ? [typeKey] : undefined,
    minPrice: price > 0 ? Math.round(price * (1 - COMP_PRICE_BAND)) : undefined,
    maxPrice: price > 0 ? Math.round(price * (1 + COMP_PRICE_BAND)) : undefined,
  };
}
