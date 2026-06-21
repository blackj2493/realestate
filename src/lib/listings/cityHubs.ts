import { searchListings } from "@/lib/typesense/client";
import { cityHubSlug } from "./listingPath";

/**
 * City-hub resolution (Phase 2b-ii). A hub URL slug (e.g. "toronto") maps to ONE OR MORE
 * raw TRREB City values ("Toronto C01" … "Toronto W10"); we group the City facet by
 * cityHubSlug at request time and filter on the whole group. This consolidates the
 * district-split cities (Toronto, London) and period-cities (St. Catharines) WITHOUT any
 * Typesense schema change or reindex.
 */

const ACTIVE_FILTER = "TransactionType:=`For Sale` && PropertyType:!=Commercial";
// Enough to capture every Ontario city + all Toronto/London district codes (default cap
// is 50, which would drop the long tail of districts).
const FACET_CAP = 250;

/**
 * Raw TRREB City value → active For-Sale count; {} on failure. `extraFilter` narrows the
 * population (e.g. "ExtrapolatedCapRate:>0" to count only cap-rate-bearing inventory).
 * Not React-cache wrapped: the sitemap calls it once, and the hub's own React-cached
 * getCityHub dedups it per request — wrapping would also pull `cache()` into the (Node)
 * sitemap test runtime.
 */
export async function getCityFacet(extraFilter = ""): Promise<Record<string, number>> {
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: extraFilter ? `${ACTIVE_FILTER} && ${extraFilter}` : ACTIVE_FILTER,
      perPage: 1,
      facetBy: "City",
      maxFacetValues: FACET_CAP,
    });
    return (res.facetDistribution?.City ?? {}) as Record<string, number>;
  } catch {
    return {};
  }
}

/** Raw City values that normalize to this hub slug, plus their summed active count. */
export async function citiesForHubSlug(slug: string): Promise<{ cities: string[]; total: number }> {
  const facet = await getCityFacet();
  const cities: string[] = [];
  let total = 0;
  for (const [city, count] of Object.entries(facet)) {
    if (cityHubSlug(city) === slug) {
      cities.push(city);
      total += count;
    }
  }
  return { cities, total };
}

/**
 * Typesense filter clause matching a set of City values. Uses the OR form (proven in the
 * Command Center's filter builder) rather than the [] multi-value form for compatibility.
 */
export function cityFilterClause(cities: string[]): string {
  if (cities.length === 0) return "";
  if (cities.length === 1) return `City:=\`${cities[0]}\``;
  return `(${cities.map((c) => `City:=\`${c}\``).join(" || ")})`;
}

/**
 * Distinct hub slugs (district-split cities consolidated) with >= min active listings.
 * `extraFilter` lets callers count a sub-population (e.g. cap-rate hubs).
 */
export async function cityHubsWithInventory(min: number, extraFilter = ""): Promise<{ slug: string; count: number }[]> {
  const facet = await getCityFacet(extraFilter);
  const bySlug = new Map<string, number>();
  for (const [city, count] of Object.entries(facet)) {
    const slug = cityHubSlug(city);
    if (!slug) continue;
    bySlug.set(slug, (bySlug.get(slug) ?? 0) + count);
  }
  return [...bySlug.entries()].filter(([, c]) => c >= min).map(([slug, count]) => ({ slug, count }));
}
