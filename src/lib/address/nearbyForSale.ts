/**
 * Nearby active listings for the address-profile page (ADDRESS_PROFILES_PLAN P1).
 *
 * IDX actives are the one fully anon-displayable content class (photos, prices,
 * brokerage — public by design), so this is the profile page's hero section. Native
 * Typesense geo-radius on the public `properties` collection — first use of the radius
 * syntax in the repo, smoke-tested live 2026-07-18 (Typesense returns
 * `geo_distance_meters` per hit when sorting by distance).
 *
 * Search-only key; runs in server components. Per-query cap far below the 100-listing
 * display limit (CLAUDE.md §4).
 */
import { getTypesenseClient } from "@/lib/typesense/client";

export interface NearbyListing {
  id: string;
  address: string;
  cityRegion: string | null;
  price: number;
  beds: number | null;
  baths: number | null;
  subType: string | null;
  imageUrl: string | null;
  /** Mandatory display (CLAUDE.md §4) — null renders the "Brokerage unavailable" fallback. */
  brokerage: string | null;
  distanceM: number | null;
}

export interface NearbyForSale {
  listings: NearbyListing[];
  totalFound: number;
  radiusKm: number;
}

const FIELDS =
  "id,UnparsedAddress,City,CityRegion,ListPrice,BedroomsTotal,BathroomsTotalInteger,PropertySubType,primaryImageUrl,ListOfficeName";

export async function getNearbyForSale(
  lat: number,
  lng: number,
  opts: { radiusKm?: number; limit?: number } = {}
): Promise<NearbyForSale | null> {
  const radiusKm = opts.radiusKm ?? 2;
  const limit = Math.min(opts.limit ?? 3, 12);
  try {
    const res = await getTypesenseClient()
      .collections("properties")
      .documents()
      .search({
        q: "*",
        query_by: "City",
        filter_by: `location:(${lat}, ${lng}, ${radiusKm} km) && TransactionType:=\`For Sale\` && ListPrice:>=100000`,
        sort_by: `location(${lat}, ${lng}):asc`,
        include_fields: FIELDS,
        per_page: limit,
      });
    const listings: NearbyListing[] = (res.hits ?? []).map((h) => {
      const d = h.document as Record<string, unknown>;
      const dist = (h as { geo_distance_meters?: { location?: number } }).geo_distance_meters?.location;
      return {
        id: String(d.id ?? ""),
        address: typeof d.UnparsedAddress === "string" ? d.UnparsedAddress.split(",")[0] : "",
        cityRegion: typeof d.CityRegion === "string" && d.CityRegion ? d.CityRegion : null,
        price: typeof d.ListPrice === "number" ? d.ListPrice : 0,
        beds: typeof d.BedroomsTotal === "number" && d.BedroomsTotal > 0 ? d.BedroomsTotal : null,
        baths: typeof d.BathroomsTotalInteger === "number" && d.BathroomsTotalInteger > 0 ? d.BathroomsTotalInteger : null,
        subType: typeof d.PropertySubType === "string" && d.PropertySubType ? d.PropertySubType : null,
        imageUrl: typeof d.primaryImageUrl === "string" && d.primaryImageUrl ? d.primaryImageUrl : null,
        brokerage: typeof d.ListOfficeName === "string" && d.ListOfficeName ? d.ListOfficeName : null,
        distanceM: typeof dist === "number" ? Math.round(dist) : null,
      };
    });
    return { listings: listings.filter((l) => l.id), totalFound: res.found ?? listings.length, radiusKm };
  } catch (err) {
    console.error("[nearbyForSale] search failed:", err);
    return null;
  }
}
