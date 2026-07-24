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
/**
 * The commercial population for the /commercial/{prov}/{city} hubs (commercial-gap
 * Phase 2) — the exact inverse of ACTIVE_FILTER's class clause, so together the two
 * hub trees partition the For-Sale inventory with no overlap and no gap.
 */
export const COMMERCIAL_ACTIVE_FILTER = "TransactionType:=`For Sale` && PropertyType:=Commercial";
// Enough to capture every Ontario city + all Toronto/London district codes (default cap
// is 50, which would drop the long tail of districts).
const FACET_CAP = 250;

/**
 * Raw TRREB City value → active For-Sale count; {} on failure. `extraFilter` narrows the
 * population (e.g. "ExtrapolatedCapRate:>0" to count only cap-rate-bearing inventory);
 * `baseFilter` swaps the population entirely (COMMERCIAL_ACTIVE_FILTER for the
 * commercial hub tree). Not React-cache wrapped: the sitemap calls it once, and the
 * hub's own React-cached getCityHub dedups it per request — wrapping would also pull
 * `cache()` into the (Node) sitemap test runtime.
 */
export async function getCityFacet(extraFilter = "", baseFilter = ACTIVE_FILTER): Promise<Record<string, number>> {
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: extraFilter ? `${baseFilter} && ${extraFilter}` : baseFilter,
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
export async function citiesForHubSlug(
  slug: string,
  baseFilter = ACTIVE_FILTER
): Promise<{ cities: string[]; total: number }> {
  const facet = await getCityFacet("", baseFilter);
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
 * City link for the address-surface breadcrumbs/pills, where the city name may be a
 * GEOCODER community ("Bolton", "Nepean") rather than a TRREB City value — those hub
 * pages render an empty "No active listings" shell (owner report 2026-07-24: never
 * send a user to nothing). Returns the hub href only when the hub actually holds live
 * inventory; otherwise a map-terminal link centered on the home (or a ?city= map query
 * without coords), which always shows real homes. isHub=false ⇒ callers should drop
 * the city row from JSON-LD breadcrumbs and hide hub-derived links (schools/walkable).
 * Best-effort by construction: a Typesense failure yields total 0 → map fallback.
 */
export async function cityHrefOrMap(
  city: string,
  provSlug: string,
  coords: [number, number] | null
): Promise<{ href: string; isHub: boolean }> {
  const slug = cityHubSlug(city);
  if (slug) {
    const { total } = await citiesForHubSlug(slug);
    if (total > 0) return { href: `/property/${provSlug.toLowerCase()}/${slug}`, isHub: true };
  }
  return {
    href: coords
      ? `/properties?lat=${coords[0].toFixed(6)}&lng=${coords[1].toFixed(6)}&z=13`
      : `/properties?city=${encodeURIComponent(city)}`,
    isHub: false,
  };
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
 * `extraFilter` lets callers count a sub-population (e.g. cap-rate hubs); `baseFilter`
 * swaps the population (commercial hub tree).
 */
export async function cityHubsWithInventory(
  min: number,
  extraFilter = "",
  baseFilter = ACTIVE_FILTER
): Promise<{ slug: string; count: number }[]> {
  const facet = await getCityFacet(extraFilter, baseFilter);
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

/**
 * Every (citySlug, neighbourhoodSlug) with >= `min` active listings, for the sitemap.
 * ONE City-facet round-trip builds the slug→City-values groups; then each qualifying
 * city's CityRegion facet is fetched with bounded concurrency (so we don't open ~200
 * simultaneous Typesense connections at build time). Capped at `maxTotal` to stay within
 * the 50k-URL sitemap budget alongside the listing URLs — any overflow is still
 * link-discoverable from the city hubs. Fully best-effort ([] on any failure) so it can
 * NEVER break the sitemap build.
 */
export async function neighbourhoodHubsForSitemap(
  min: number,
  maxTotal = 3000
): Promise<{ citySlug: string; hoodSlug: string; count: number }[]> {
  try {
    const cityFacet = await getCityFacet();
    const citiesBySlug = new Map<string, string[]>();
    const totalBySlug = new Map<string, number>();
    for (const [city, count] of Object.entries(cityFacet)) {
      const slug = cityHubSlug(city);
      if (!slug) continue;
      citiesBySlug.set(slug, [...(citiesBySlug.get(slug) ?? []), city]);
      totalBySlug.set(slug, (totalBySlug.get(slug) ?? 0) + count);
    }
    // Only enumerate neighbourhoods for cities that themselves clear the bar.
    const slugs = [...citiesBySlug.keys()].filter((s) => (totalBySlug.get(s) ?? 0) >= min);

    const out: { citySlug: string; hoodSlug: string; count: number }[] = [];
    const CONCURRENCY = 8;
    for (let i = 0; i < slugs.length && out.length < maxTotal; i += CONCURRENCY) {
      const chunk = slugs.slice(i, i + CONCURRENCY);
      const facets = await Promise.all(
        chunk.map((slug) => getCityRegionFacet(citiesBySlug.get(slug) ?? []))
      );
      chunk.forEach((citySlug, j) => {
        const bySlug = new Map<string, number>();
        for (const [region, count] of Object.entries(facets[j])) {
          const hoodSlug = slugify(region);
          if (!hoodSlug) continue;
          bySlug.set(hoodSlug, (bySlug.get(hoodSlug) ?? 0) + count);
        }
        for (const [hoodSlug, count] of bySlug) {
          if (count >= min) out.push({ citySlug, hoodSlug, count });
        }
      });
    }
    return out.slice(0, maxTotal);
  } catch {
    return [];
  }
}
