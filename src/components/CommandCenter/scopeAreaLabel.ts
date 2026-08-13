/**
 * scopeAreaLabel — name the map viewport from the rows already on screen.
 *
 * The ledger's scope chip used to read a bare "Map area", which states the KIND of
 * scope without answering the question it raises: *which* area? That gap is sharpest
 * on mobile, where the map lives on a separate tab — the chip pointed at a surface the
 * user could not see.
 *
 * Every loaded row already carries City / CityRegion (the terminal query only strips
 * the heavy RawImages / RawRooms fields), so the name is derivable client-side with no
 * geocode and no extra fetch. Faceting City/CityRegion server-side would give exact
 * whole-result-set counts, but those are high-cardinality fields (484 cities / 1000s of
 * neighbourhoods) on a query that re-fires on every map pan — the wrong place to spend
 * Typesense RAM for a label.
 *
 * Like cohortPercentiles, the cohort is exactly what's on screen (the ≤100 listings the
 * active query returned), so `+N` counts the areas among the LOADED rows, not the full
 * result set — the same sample the ledger footer already reports as "N shown / M total".
 *
 * LEVEL CHOICE, measured against the live index rather than guessed. A realistic
 * terminal viewport (~3 km over north-east Toronto, 173 actives) spans 9 neighbourhoods
 * with the largest holding only 30% — so a "does one neighbourhood dominate?" test
 * essentially never fires, and every such viewport would fall back to the city. The
 * useful, human names are the neighbourhoods ("Henry Farm", "Unionville"), so we name
 * the largest one and let `+N` carry the breadth. Only a genuinely zoomed-out view
 * (>MAX_NAMED_AREAS distinct neighbourhoods — the same probe saw 141 across north
 * Toronto → Markham) steps up to the city level, where the count is small again.
 */

import { cityDisplayName } from "@/lib/listings/listingPath";

/**
 * Above this many distinct neighbourhoods the viewport is too fragmented for one of
 * them to stand for it, and the city is the better label. Sized off the live index:
 * a street-level-to-district viewport lands under it, a multi-city one far over.
 */
export const MAX_NAMED_AREAS = 12;

/** The only two fields this needs — kept structural so tests don't build a full doc. */
export interface AreaFields {
  City?: string | null;
  CityRegion?: string | null;
}

interface Tally {
  top: string;
  /** Distinct OTHER names present alongside `top`. */
  others: number;
}

function tally(names: string[]): Tally | null {
  if (names.length === 0) return null;

  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);

  let top = "";
  let topCount = 0;
  for (const [name, count] of counts) {
    // Ties break alphabetically so the label stays put across re-queries that return
    // the same rows in a different order (Typesense makes no ordering promise among
    // equal-scoring hits).
    if (count > topCount || (count === topCount && name < top)) {
      top = name;
      topCount = count;
    }
  }

  return { top, others: counts.size - 1 };
}

function format(t: Tally | null): string | null {
  if (!t) return null;
  return t.others > 0 ? `${t.top} +${t.others}` : t.top;
}

/**
 * Human label for the area the given listings sit in, or null when the rows carry no
 * usable place name (empty result set, or feed rows missing both fields).
 */
export function scopeAreaLabel(listings: readonly AreaFields[]): string | null {
  const neighbourhoods: string[] = [];
  const cities: string[] = [];

  for (const listing of listings) {
    // Raw City is district-coded for Toronto ("Toronto C15"); never show that to a
    // reader, at either level.
    const city = cityDisplayName(listing.City?.trim() ?? "");
    // A blank CityRegion is a real feed state, not bad data: TRREB ships no CityRegion
    // at all for whole markets (Waterloo Region, Brantford). Fall back to the city so
    // those rows still count toward the tally instead of dropping out of it.
    const neighbourhood = listing.CityRegion?.trim() || city;
    if (neighbourhood) neighbourhoods.push(neighbourhood);
    if (city) cities.push(city);
  }

  const hood = tally(neighbourhoods);
  if (hood && hood.others < MAX_NAMED_AREAS) return format(hood);

  // Too fragmented to name a neighbourhood — the city is the honest level. Falls back
  // to the neighbourhood tally if the rows somehow carry no city at all.
  return format(tally(cities)) ?? format(hood);
}
