/**
 * Today's power-of-sale homes for a city (or all of Ontario), from the Typesense
 * `properties` collection: the power_of_sale description signal, For Sale, residential,
 * cheapest first. IDX listing data, the same source and filters as the city hubs.
 * Never throws: an empty list on failure (the page still has its facts).
 */
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { citiesForHubSlug, cityFilterClause } from "@/lib/listings/cityHubs";

const PER_PAGE = 24;
const BASE = "description_signals:=power_of_sale && TransactionType:=`For Sale` && PropertyType:!=Commercial";

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
