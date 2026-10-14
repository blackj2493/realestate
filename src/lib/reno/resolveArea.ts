// Pure helpers for GET /api/reno/resolve-area. Kept out of the route so they can be tested
// without Typesense or the database.
import { normalizeCityRegion, type CohortTree } from '@/lib/avm/cohorts';

export type Vote = { cr: string; city?: string };

/** Map a raw (city, cityRegion) to a trained cohort — community match across the whole
 *  tree (more specific than City; immune to the City:=Toronto quirk), preferring a city match. */
export function matchCohort(
  tree: CohortTree,
  city: string | undefined,
  cityRegion: string | undefined,
): { city: string; cityRegion: string } | null {
  if (!cityRegion) return null;
  const target = normalizeCityRegion(cityRegion).trim().toLowerCase();
  if (!target) return null;
  const lc = (city ?? '').trim().toLowerCase();
  let fallback: { city: string; cityRegion: string } | null = null;
  for (const [c, comms] of Object.entries(tree)) {
    for (const cm of comms) {
      if (normalizeCityRegion(cm.cityRegion).trim().toLowerCase() === target) {
        if (c.toLowerCase() === lc) return { city: c, cityRegion: cm.cityRegion };
        fallback ??= { city: c, cityRegion: cm.cityRegion };
      }
    }
  }
  return fallback;
}

/**
 * Rank every voted community, best first (sold weighted ×1.4, nearer = heavier).
 *
 * Returns the WHOLE ranking, not just the winner: the top vote is often a community with
 * no trained cohort (73 Elvira Cres, Markham → "Cedarwood"), and the caller must fall
 * through to the next one ("Middlefield") instead of giving up.
 */
export function rankVotes(active: Vote[], sold: string[]): Array<{ cityRegion: string; city: string | null }> {
  const score = new Map<string, number>();
  const cityFor = new Map<string, string>();
  sold.forEach((cr, i) => score.set(cr, (score.get(cr) ?? 0) + (sold.length - i) * 1.4));
  active.forEach((v, i) => {
    score.set(v.cr, (score.get(v.cr) ?? 0) + (active.length - i));
    if (v.city && !cityFor.has(v.cr)) cityFor.set(v.cr, v.city);
  });
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cr]) => ({ cityRegion: cr, city: cityFor.get(cr) ?? null }));
}

/** "Toronto C08" → "toronto"; "Markham" → "markham". TRREB appends a district code to Toronto. */
export function cityKey(city: string | null | undefined): string {
  return (city ?? '')
    .toLowerCase()
    .replace(/\s+[a-z]\d{2}$/, '')
    .trim();
}

/**
 * Does a record's feed City agree with the city the user typed (or the geocoder found)?
 * The loose sold lookup matches on street number + street name only, so without this
 * "10 Main Street, Markham" resolved to a Main Street in Mississauga.
 */
export function sameCity(recordCity: string | null | undefined, wanted: string | null | undefined): boolean {
  const a = cityKey(recordCity);
  const b = cityKey(wanted);
  return !!a && !!b && a === b;
}
