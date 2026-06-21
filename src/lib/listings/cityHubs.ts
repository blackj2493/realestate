import { searchListings } from "@/lib/typesense/client";
import { cityHubSlug, slugify } from "./listingPath";

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

// ── Neighbourhood hubs (Phase 2e) ───────────────────────────────────────────
// One level below the city hub: /property/{prov}/{city}/{neighbourhood}, keyed off the
// TRREB CityRegion (community) facet SCOPED to the city's City-group. The city scope is
// what disambiguates non-unique community names (e.g. a "Downtown" exists in many cities).

/**
 * Active For-Sale CityRegion (community) → count, WITHIN a set of City values. {} on
 * failure or empty input. 250 facet values comfortably covers Toronto's ~140 communities.
 */
export async function getCityRegionFacet(cities: string[]): Promise<Record<string, number>> {
  if (cities.length === 0) return {};
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `${cityFilterClause(cities)} && ${ACTIVE_FILTER}`,
      perPage: 1,
      facetBy: "CityRegion",
      maxFacetValues: FACET_CAP,
    });
    return (res.facetDistribution?.CityRegion ?? {}) as Record<string, number>;
  } catch {
    return {};
  }
}

/** Typesense filter clause matching a set of CityRegion values (OR form). */
export function cityRegionFilterClause(regions: string[]): string {
  if (regions.length === 0) return "";
  if (regions.length === 1) return `CityRegion:=\`${regions[0]}\``;
  return `(${regions.map((r) => `CityRegion:=\`${r}\``).join(" || ")})`;
}

/**
 * Neighbourhoods of a city hub: each distinct CityRegion slug + its real TRREB name and
 * summed active count, sorted busiest-first. Powers the city hub's "browse by
 * neighbourhood" links. (Multiple raw regions rarely collide on a slug, but we sum them
 * if they do, keeping the first-seen name.)
 */
export async function neighbourhoodsForCity(
  citySlug: string
): Promise<{ slug: string; name: string; count: number }[]> {
  const { cities } = await citiesForHubSlug(citySlug);
  const facet = await getCityRegionFacet(cities);
  const bySlug = new Map<string, { name: string; count: number }>();
  for (const [region, count] of Object.entries(facet)) {
    const slug = slugify(region);
    if (!slug) continue;
    const existing = bySlug.get(slug);
    if (existing) existing.count += count;
    else bySlug.set(slug, { name: region, count });
  }
  return [...bySlug.entries()]
    .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Resolve a (city slug, neighbourhood slug) pair → the City group, the matching raw
 * CityRegion value(s), a display name, and the summed active count. Mirrors
 * citiesForHubSlug; the neighbourhood query filters on cities AND regions together.
 */
export async function regionsForHoodSlug(
  citySlug: string,
  hoodSlug: string
): Promise<{ cities: string[]; regions: string[]; name: string; total: number }> {
  const { cities } = await citiesForHubSlug(citySlug);
  const facet = await getCityRegionFacet(cities);
  const regions: string[] = [];
  let name = "";
  let total = 0;
  for (const [region, count] of Object.entries(facet)) {
    if (slugify(region) === hoodSlug) {
      regions.push(region);
      if (!name) name = region;
      total += count;
    }
  }
  return { cities, regions, name, total };
}
