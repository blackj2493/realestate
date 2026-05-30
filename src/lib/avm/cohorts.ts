// src/lib/avm/cohorts.ts
// Pure builder for the Hidden Equity neighbourhood picker. Source-agnostic: the
// route supplies audit rows + (city, city_region) pairs; this groups them into a
// {city -> communities[]} tree of ONLY modelable (trained) cohorts.

export interface CohortRow {
  city_region: string;
  property_sub_type: string;
  model_accuracy_score: number; // R²
  total_sales_analyzed: number;
}
export interface CityRegionPair { city: string | null; city_region: string | null; }

export interface CohortCommunity {
  community: string;   // normalized display label
  cityRegion: string;  // RAW city_region — the lookup key passed to calculateAVM
  types: string[];     // modelable property_sub_types, sorted
}
export type CohortTree = Record<string, CohortCommunity[]>;

/** Trained-cohort gate: where the value-add report actually prices moves. */
const TRAINED_R2 = 0.5;
const TRAINED_N = 30;
/** Legacy prefixes on some matrix city_regions: "1001 - BR Bronte", "7709 - Barrhaven". */
const PREFIX_RE = /^\d+\s*-\s*(?:[A-Z]{1,3}\s+)?/;

/** Display label only — the RAW city_region remains the lookup key. */
export function normalizeCityRegion(raw: string): string {
  return raw.replace(PREFIX_RE, '').trim() || raw;
}

export function buildCohortTree(rows: CohortRow[], pairs: CityRegionPair[]): CohortTree {
  const cityByRegion = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.city || !p.city_region) continue;
    if (!cityByRegion.has(p.city_region)) cityByRegion.set(p.city_region, new Set());
    cityByRegion.get(p.city_region)!.add(p.city);
  }

  const tree = new Map<string, Map<string, { community: string; cityRegion: string; types: Set<string> }>>();
  for (const r of rows) {
    if (!(r.model_accuracy_score >= TRAINED_R2 && r.total_sales_analyzed >= TRAINED_N)) continue;
    const cities = cityByRegion.get(r.city_region);
    const cityList = cities && cities.size ? [...cities] : ['Other'];
    const community = normalizeCityRegion(r.city_region);
    for (const city of cityList) {
      if (!tree.has(city)) tree.set(city, new Map());
      const comms = tree.get(city)!;
      if (!comms.has(r.city_region)) comms.set(r.city_region, { community, cityRegion: r.city_region, types: new Set() });
      comms.get(r.city_region)!.types.add(r.property_sub_type);
    }
  }

  const out: CohortTree = {};
  for (const [city, comms] of [...tree.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out[city] = [...comms.values()]
      .map((c) => ({ community: c.community, cityRegion: c.cityRegion, types: [...c.types].sort() }))
      .sort((a, b) => a.community.localeCompare(b.community));
  }
  return out;
}
