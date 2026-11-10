/**
 * Today's power-of-sale homes for a city (or all of Ontario), from the Typesense
 * `properties` collection: the power_of_sale description signal, For Sale, residential,
 * a real asking price (MIN_LIST_PRICE), cheapest first. IDX listing data, the same source
 * and filters as the city hubs.
 * Never throws: an empty list on failure (the page still has its facts).
 */
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { citiesForHubSlug, cityFilterClause } from "@/lib/listings/cityHubs";

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
