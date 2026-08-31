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

/**
 * WHAT KIND OF NUMBER STANDS BEHIND A RENT (133).
 *
 * `match_tier` says how CLOSE the comps are. This says whether they are transactions
 * at all. Until 133 every cohort was an ASKING rent — a landlord's offer — because the
 * ETL read `listings.list_price` and nothing else, while 271,287 signed lease records
 * sat unused in `raw_vow_sold`.
 *
 *   closed_12   median of leases SIGNED in the last 12 months
 *   closed_24   ditto over 24 months — inclusive of the 12; it exists to keep a thin
 *               cohort alive, not to describe months 13-24
 *   asking      median of ACTIVE for-lease asks
 *
 * THE TWO ARE NOT SYSTEMATICALLY APART. Over 3,175 matched `city_bath` cohorts the
 * median difference is 0.00% and the mean -$51, so an ask in the right cohort is an
 * honest comp — which is why the ladder keeps it as a same-rung fallback instead of
 * discarding the coverage it buys.
 *
 * THIS LIVES IN src/lib SO BOTH SIDES CAN IMPORT IT. The worker can reach into
 * `@/lib`, the web app cannot reach into `scripts/` — and a rule written out longhand
 * on both sides of that wall is how the grid and the ladder disagreed for a year, and
 * how MONTHLY_RENT_BAND had to be moved here in the first place.
 */
export type RentBasis = 'closed_12' | 'closed_24' | 'asking';

/**
 * Preference order WITHIN a rung. Recency sits inside the rung deliberately: a
 * 20-month-old close on the right street beats a fresh one in the wrong city, so the
 * geography is only relaxed after every basis at this rung has failed.
 *
 * Measured out-of-time — index built from closes older than 3 months, scored against
 * 40,408 closes from the last 3 months that it could not have seen:
 *
 *   asking-only (the old ladder)   covered 95.6%   median err 6.52%   p90 20.7%
 *   this order                     covered 98.7%   median err 5.53%   p90 18.1%
 */
export const RENT_BASIS_PREFERENCE: readonly RentBasis[] = ['closed_12', 'closed_24', 'asking'];

/**
 * Pick the best row from the several a cohort key now returns.
 *
 * Before 133 a key matched exactly one row, so all four readers of
 * `rental_market_index` used `.maybeSingle()` — which ERRORS on more than one row.
 * Every one of them had to change, and none of them may restate the ranking: this
 * function IS the ranking.
 *
 * Returns null for an empty set AND for a set whose every row carries a basis this
 * build does not know. Unknown provenance is not a comp — ranking it last would
 * publish a number nobody can explain.
 */
export function pickPreferredBasis<T extends { basis?: string | null }>(
  rows: readonly T[] | null | undefined
): T | null {
  if (!rows || rows.length === 0) return null;
  for (const b of RENT_BASIS_PREFERENCE) {
    const hit = rows.find((r) => r.basis === b);
    if (hit) return hit;
  }
  return null;
}

/** Plain-language name for the basis. Reaches the same readers the emails do, so it
 *  says what it means rather than naming the column. */
export function rentBasisLabel(basis: string | null | undefined): string | null {
  switch (basis) {
    case 'closed_12': return 'signed leases, past year';
    case 'closed_24': return 'signed leases, past two years';
    case 'asking': return 'current asking rents';
    default: return null;
  }
}

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

/**
 * WHAT STANDS BEHIND A RENT, IN ONE SENTENCE (this change).
 *
 * `rentTierLabel` says how CLOSE the comps are and `rentBasisLabel` says whether they
 * are transactions. Neither says HOW MANY, and the count is the thing a reader can act
 * on: the Underwriting Sandbox published "$3,993" with the same weight whether forty
 * signed leases stood behind it or three asks did.
 *
 * The gap was visible on W13714292, a 4+3 detached in Brampton. The sandbox seeded
 * $3,993 from the `city_bath` rung. Six inches above it on the same page, the leased
 * grid printed its own medians WITH sample counts (×14, ×24) from a 2 km radius, and
 * the two never agreed — because the ladder holds the bath count and gives up the
 * neighbourhood, while the grid holds the neighbourhood and has no bath axis at all.
 * A reader could see both numbers and had nothing to tell them apart.
 *
 * NO THRESHOLD LIVES HERE. A "thin sample" cut would be a judgement about a cohort
 * this module cannot see, and the repo has been burned by exactly that kind of
 * invented constant (the $1,500 suite offset, the 1.6x multiplier). Print the count
 * and let the reader weigh it, the way the grid already does.
 *
 * Returns null when NEITHER part is known — an empty provenance line is worse than
 * none, because it implies the number has none.
 */
export function rentProvenanceNote(input: {
  basis?: string | null;
  sampleCount?: number | null;
}): string | null {
  const n =
    typeof input.sampleCount === 'number' && Number.isFinite(input.sampleCount) && input.sampleCount > 0
      ? Math.trunc(input.sampleCount)
      : null;
  const phrase = basisPhrase(input.basis, n ?? 2);
  if (phrase && n !== null) return `Based on ${n.toLocaleString()} ${phrase}.`;
  if (phrase) return `Based on ${phrase}.`;
  if (n !== null) return `Based on ${n.toLocaleString()} comparable ${n === 1 ? 'rent' : 'rents'}.`;
  return null;
}

/** The countable noun for a basis, agreeing in number with `n`. Plain language: these
 *  strings reach the same readers the emails do (voice.md §5.1). */
function basisPhrase(basis: string | null | undefined, n: number): string | null {
  const many = n !== 1;
  switch (basis) {
    case 'closed_12': return many ? 'signed leases from the past year' : 'signed lease from the past year';
    case 'closed_24': return many ? 'signed leases from the past two years' : 'signed lease from the past two years';
    case 'asking': return many ? 'current asking rents' : 'current asking rent';
    default: return null;
  }
}
