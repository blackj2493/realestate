/**
 * Today's power-of-sale homes for a city (or all of Ontario), from the Typesense
 * `properties` collection: the power_of_sale description signal, For Sale, residential,
 * a real asking price (MIN_LIST_PRICE), cheapest first. IDX listing data, the same source
 * and filters as the city hubs.
 * Never throws: an empty list on failure (the page still has its facts).
 */
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { citiesForHubSlug, cityFilterClause, cityHubsWithInventory } from "@/lib/listings/cityHubs";
import { cityHubSlug, deslugCity } from "@/lib/listings/listingPath";
import { OTTAWA_AREAS } from "@/lib/dashboard/ottawaAreas";

const PER_PAGE = 24;
/**
 * A placeholder asking price ($1, $100: "price on request" or a tender) is not a price.
 * Sorted cheapest first, one such listing led the Ontario page as "$1" (vacant land,
 * Gravenhurst, 2026-11-10). It is left out of the cards and the count. The next real price
 * was $89,900, so $10,000 keeps every real listing.
 */
export const MIN_LIST_PRICE = 10_000;
const BASE = `description_signals:=power_of_sale && TransactionType:=\`For Sale\` && PropertyType:!=Commercial && ListPrice:>=${MIN_LIST_PRICE}`;

export async function powerOfSaleListings(citySlug: string | null): Promise<{ listings: ListingDocument[]; totalFound: number }> {
  try {
    let filter = BASE;
    if (citySlug) {
      const { cities } = await citiesForHubSlug(citySlug);
      if (cities.length === 0) return { listings: [], totalFound: 0 };
      filter = `${cityFilterClause(cities)} && ${BASE}`;
    }
    const res = await searchListings({ query: "*", rawFilterBy: filter, perPage: PER_PAGE, sortBy: "ListPrice", sortOrder: "asc" });
    return { listings: res.listings, totalFound: res.totalFound };
  } catch (err) {
    console.error(`[powerOfSale] listings query failed for ${citySlug ?? "ontario"}:`, err);
    return { listings: [], totalFound: 0 };
  }
}

/** A city outside the 15 board markets gets a page with this many power-of-sale homes for sale. */
export const MIN_POS_CITY = 3;

/**
 * Every city hub with at least `min` power-of-sale homes for sale now, most first. The
 * 15 board cities have pages regardless; this list opens the page to the rest of Ontario
 * ("power of sale homes in Barrie"), and the sitemap and the city lists read it so a page
 * is linked only while it has homes on it. [] on any Typesense failure.
 */
export async function posCityHubs(min = MIN_POS_CITY): Promise<{ slug: string; city: string; count: number }[]> {
  try {
    const hubs = await cityHubsWithInventory(min, `description_signals:=power_of_sale && ListPrice:>=${MIN_LIST_PRICE}`);
    // Ottawa's ~51 areas are each their own City value, but /power-of-sale/ottawa covers them.
    const ottawa = new Set(OTTAWA_AREAS.map(cityHubSlug));
    return hubs
      .filter((h) => !ottawa.has(h.slug))
      .map((h) => ({ ...h, city: deslugCity(h.slug) }))
      .sort((a, b) => b.count - a.count);
  } catch (err) {
    console.error("[powerOfSale] city list failed:", err);
    return [];
  }
}
