/**
 * Pure mapping of a Mapbox Search Box `forward` response to our {label, lat, lng} list.
 *
 * Split out of route.ts so the ranking and de-duplication are testable without network
 * or a Next request. See route.ts for why this API replaced Geocoding v5/v6.
 */

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

interface SearchBoxFeature {
  geometry?: { coordinates?: unknown };
  properties?: {
    name?: string;
    name_preferred?: string;
    full_address?: string;
    place_formatted?: string;
    feature_type?: string;
    poi_category?: unknown;
  };
}

/**
 * Mapbox's POI index carries short-term-rental listings, and their titles are stuffed with
 * the landmarks they sit near. "Ajax GO Station" returned "Entire basement walkable to Ajax
 * GO station - Suite" and "Ajax Beautiful Cozy Room- 10 mins to Go Station, Water Front
 * Park, Plaza" ABOVE the station itself, which is the reported bug wearing a different hat.
 *
 * The tell is not the wording — it is `poi_category`. Every real destination carries one
 * ("train station", "public transit station", "parking"); those rental records carry an
 * EMPTY array. So demote on the empty category, never on a name pattern: a keyword list
 * would also bury "Bramalea Church of God Prayer Centre".
 *
 * DEMOTE, do not drop. An uncategorized POI is unranked, not proven junk, and it still
 * shows once the categorized results run out.
 */
function isUncategorizedPoi(p: NonNullable<SearchBoxFeature["properties"]>): boolean {
  return p.feature_type === "poi" && Array.isArray(p.poi_category) && p.poi_category.length === 0;
}

/**
 * Two Mapbox POI records for one real place land metres apart under near-identical
 * names — "union station" returns three Union Stations inside 80 m, and "Oakville GO"
 * returns the station, its bus terminal and a bare "Oakville GO Bus" stop. A dropdown of
 * five that spends four rows on the same building is the same dead end as returning
 * nothing. Collapse on rounded coordinate (~11 m at 4 dp) AND on case-folded label, so
 * either kind of duplicate drops out while genuinely distinct nearby POIs survive.
 */
const COORD_DP = 4;

/** A POI reads best as "Union Station · Toronto, M5J 1E6"; an address is already whole. */
function labelFor(p: NonNullable<SearchBoxFeature["properties"]>): string {
  const name = (p.name_preferred || p.name || "").trim();
  const context = (p.place_formatted || "").trim();
  if (p.feature_type === "poi" && name) return context ? `${name} · ${context}` : name;
  return (p.full_address || (name && context ? `${name}, ${context}` : name) || context).trim();
}

export function mapSearchBoxFeatures(features: unknown, limit = 5): GeocodeResult[] {
  if (!Array.isArray(features)) return [];
  const out: GeocodeResult[] = [];
  const seenCoord = new Set<string>();
  const seenLabel = new Set<string>();

  // Stable partition, so Mapbox's own relevance order survives inside each group. Runs
  // BEFORE de-duplication, so when two records collide the categorized one is the keeper.
  const ranked = [...(features as SearchBoxFeature[])].sort(
    (a, b) =>
      Number(isUncategorizedPoi(a?.properties ?? {})) - Number(isUncategorizedPoi(b?.properties ?? {}))
  );

  for (const raw of ranked) {
    const coords = raw?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords as number[];
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const label = labelFor(raw.properties ?? {});
    if (!label) continue;

    const coordKey = `${lat.toFixed(COORD_DP)},${lng.toFixed(COORD_DP)}`;
    const labelKey = label.toLowerCase();
    if (seenCoord.has(coordKey) || seenLabel.has(labelKey)) continue;
    seenCoord.add(coordKey);
    seenLabel.add(labelKey);

    out.push({ label, lat, lng });
    if (out.length >= limit) break;
  }
  return out;
}
