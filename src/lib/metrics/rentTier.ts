/**
 * How much to trust a rent-derived number, from the rung that produced it.
 *
 * `cap_rate_est` and `gross_yield_est` are only as good as the rent behind them, and
 * that rent comes off a five-rung ladder whose accuracy spans a factor of three.
 * Leave-one-out median error, each measured on the population that lands on it:
 *
 *   nbhd         5.56%   p90 19.5%   neighbourhood + bath count
 *   city_bath    8.22%   p90 28.6%   municipality + bath count
 *   city        13.73%   p90 47.6%   municipality, baths relaxed
 *   city_family 13.17%   p90 42.9%   municipality, sub-type pooled   (124)
 *   county      14.49%   p90 45.5%   county, sub-type exact          (124)
 *
 * That error AMPLIFIES into a cap rate: NOI is rent minus operating cost, so a
 * percentage error on the rent becomes a larger one on the difference. CAP_RATE_BAND
 * cannot catch it either — a wrong 4.2% is indistinguishable from a right 4.2%.
 *
 * So surfaces branch on confidence rather than showing every estimate identically.
 * This is not only about the two rungs added in 124: `city` has been served next to a
 * neighbourhood-grade comp all along, on ~14,883 listings.
 *
 * The bands are deliberately coarse. The exact cut between "comp" and "area" is a
 * judgement about what a user should read as a property-level number, and the numbers
 * above are what it was made on — re-measure before moving it.
 */

/** Rungs in accuracy order. Mirrors MatchTier in scripts/worker/services/rentModel.ts. */
export type RentMatchTier = 'nbhd' | 'city_bath' | 'city' | 'city_family' | 'county';

export type RentConfidence = 'comp' | 'area' | 'none';

const AREA_TIERS: ReadonlySet<string> = new Set(['city', 'city_family', 'county']);
const COMP_TIERS: ReadonlySet<string> = new Set(['nbhd', 'city_bath']);

/**
 * 'comp'  — the rent came from the subject's own neighbourhood or municipality at the
 *           subject's bath count. Safe to present as a property-level figure.
 * 'area'  — the rent is an area average: the sub-type, the bath count or the
 *           municipality was relaxed to find enough leases. Present it as an area
 *           figure, or keep it out of a headline number.
 * 'none'  — no rent comp exists. The metric is absent, not zero.
 */
export function rentTierConfidence(tier: string | null | undefined): RentConfidence {
  if (!tier) return 'none';
  if (COMP_TIERS.has(tier)) return 'comp';
  if (AREA_TIERS.has(tier)) return 'area';
  return 'none'; // unknown rung: treat as unusable rather than guess at its accuracy
}

/** Short human label for the basis of a rent-derived figure. */
export function rentTierLabel(tier: string | null | undefined): string | null {
  switch (tier) {
    case 'nbhd': return 'Neighbourhood comps';
    case 'city_bath': return 'City comps, same bath count';
    case 'city': return 'City average';
    case 'city_family': return 'City average, similar property types';
    case 'county': return 'County average';
    default: return null;
  }
}

/**
 * One sentence a tooltip can show verbatim, explaining what stands behind the number.
 * Plain language on purpose — this reaches the same readers the emails do.
 */
export function rentTierExplainer(tier: string | null | undefined): string | null {
  switch (tier) {
    case 'nbhd':
      return 'Based on rents for similar homes in this neighbourhood with the same number of bathrooms.';
    case 'city_bath':
      return 'Based on rents for similar homes in this city with the same number of bathrooms.';
    case 'city':
      return 'Based on rents for similar homes across this city. Fewer close matches were available, so treat it as a city-wide figure.';
    case 'city_family':
      return 'Based on rents for comparable property types across this city. No close match for this exact property type was available, so treat it as a city-wide figure.';
    case 'county':
      return 'Based on rents across this county. This area has few rental listings, so treat it as a broad regional figure.';
    default:
      return null;
  }
}
