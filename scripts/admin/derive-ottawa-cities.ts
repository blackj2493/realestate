/**
 * Regenerate src/lib/dashboard/ottawaAreas.ts (the "Ottawa" region group).
 *
 * Facets the live `City` field within a radius of downtown Ottawa, minus a blocklist of the
 * surrounding SEPARATE municipalities + a few mis-geocoded far-away outliers. Prints the
 * kept list as a ready-to-paste array plus what it excluded, so a maintainer can eyeball
 * drift. Read-only (search-only client). See ottawaAreas.ts for context.
 *
 *   npx tsx scripts/admin/derive-ottawa-cities.ts
 */
import "dotenv/config";
import { searchListings } from "@/lib/typesense/client";

const OTTAWA_CENTER = "45.4215, -75.6972";
const RADIUS_KM = 45;

// Separate municipalities (Lanark / Renfrew / Prescott-Russell / SDG / Grenville) that fall
// inside the radius but are their own cities — addable individually via search — plus a few
// obviously mis-geocoded far-away values. Everything else in the radius is City of Ottawa.
const EXCLUDE = new Set<string>([
  "Clarence-Rockland", "Russell", "The Nation", "Casselman",
  "Mississippi Mills", "Carleton Place", "Beckwith", "Lanark Highlands", "Drummond/North Elmsley", "Tay Valley",
  "North Dundas", "South Dundas", "North Grenville",
  "Renfrew", "McNab/Braeside", "Laurentian Valley", "North Stormont",
  "North Bay", "Collingwood", "Minden Hills", "North Kawartha", "Haldimand",
]);

async function main() {
  const res = await searchListings({
    query: "*",
    rawFilterBy: `location:(${OTTAWA_CENTER}, ${RADIUS_KM} km)`,
    perPage: 1,
    facetBy: "City",
    maxFacetValues: 250,
  });
  const facet = (res.facetDistribution?.City ?? {}) as Record<string, number>;
  const rows = Object.entries(facet).map(([value, count]) => ({ value, count }));

  const included = rows.filter((r) => !EXCLUDE.has(r.value)).sort((a, b) => a.value.localeCompare(b.value));
  const excluded = rows.filter((r) => EXCLUDE.has(r.value)).sort((a, b) => b.count - a.count);
  const sum = (rs: { count: number }[]) => rs.reduce((s, r) => s + r.count, 0);

  console.log(`City of Ottawa: ${included.length} areas, ${sum(included)} listings`);
  console.log(`Excluded:       ${excluded.length} areas, ${sum(excluded)} listings — ${excluded.map((r) => r.value).join(", ")}`);
  console.log("\n// ---- OTTAWA_AREAS (paste into src/lib/dashboard/ottawaAreas.ts) ----");
  console.log(included.map((r) => `  ${JSON.stringify(r.value)},`).join("\n"));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
