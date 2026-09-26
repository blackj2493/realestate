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

export type RentConfidence = 'comp' | 'area' | 'wide' | 'none';

const AREA_TIERS: ReadonlySet<string> = new Set(['city', 'city_family', 'county']);
/**
 * The rungs whose answer is safe to present as a property-level figure.
 *
 * The three `_size` rungs joined in 150, and NOT on the reasoning that they look specific.
 * Backtested blow-up rate (share of answers more than 50% off) on 38,301 held-out closed
 * leases, worst last:
 *
 *   nbhd_size       0.48%      city_bath       3.00%
 *   city_bath_size  1.24%      nbhd            4.62%
 *   city_size       2.47%      city            8.75%
 *
 * `city_size` drops the bath axis, so it reads as the loosest of the three — but it still
 * beats both rungs that were already classified 'comp'. All three belong here on merit.
 *
 * Until 150 they were in NEITHER set, so rentTierConfidence() answered 'none' for the rung
 * that serves 68% of listings, and the sandbox lost its label and tooltip for all of them.
 */
const COMP_TIERS: ReadonlySet<string> = new Set([
  'nbhd_size', 'city_bath_size', 'city_size', 'nbhd', 'city_bath',
]);

/**
 * Ratio of a cohort's interquartile spread to its median, above which the median stops
 * being a usable point estimate for any single member of that cohort.
 *
 * MEASURED, not chosen. On 38,301 held-out closed leases the ladder's overall blow-up rate
 * (>50% off) is 1.13%. Split by this ratio:
 *
 *   (p75-p25)/median > 0.5     1.46% of listings     18.13% blow up     16.1x lift
 *   (p75-p25)/median <= 0.5   98.54% of listings      0.87% blow up
 *
 * For contrast, `sample_count < 10` flags 35% of listings for a 1.65x lift — which is why
 * an earlier attempt to gate thin rungs made accuracy worse rather than better. Depth is
 * not the signal. Spread is. Blow-ups carry a median ratio of 0.237 against 0.096
 * elsewhere.
 *
 * This is the threshold the comment below warns against inventing — so it is worth being
 * explicit about the difference. A "thin sample" cut would be a guess about a cohort this
 * module cannot see. This is a measurement of a quantity the caller hands in, taken on
 * held-out data, with the retained and discarded populations both stated above. Move it
 * only with a fresh backtest.
 */
export const RENT_DISPERSION_CEILING = 0.5;

/**
 * How far the winning rung may sit from its postal-area cohort before we stop publishing.
 *
 * Expressed as |ln(ladder / fsa)|, so it is symmetric — 2x too high and 2x too low are the
 * same distance. 0.5 is a factor of about 1.65.
 *
 * WHY A SECOND SIGNAL AT ALL. Dispersion (above) asks whether a cohort agrees with ITSELF.
 * It cannot see a cohort that is tight around the wrong value, and that is the failure that
 * prompted this work: 473 Dupont reads $7,000 from six large Annex condos that agree closely
 * with each other (spread 0.104) while every M6G lease says ~$2,500. A neighbourhood label
 * pools M5R (median $2,900) with M6G ($2,175); the postal FSA does not.
 *
 * MEASURED on the same 38,301 held-out closed leases as RENT_DISPERSION_CEILING:
 *
 *   flag                          flagged   blow-in   blow-out   recall    lift
 *   spread > 0.5 alone              1.46%    18.13%      0.87%    23.5%   16.1x
 *   this alone, at 0.5              0.51%    21.51%      1.02%     9.7%   19.1x
 *   either                          1.78%    16.74%      0.84%    26.5%   14.9x
 *
 * The two catch different listings, which is the whole reason to carry both: recall rises
 * 23.5% -> 26.5% for 0.32pp more of the book withheld.
 *
 * A DEPTH REQUIREMENT ON THE FSA COHORT WAS MEASURED AND IS NOT WORTH IT. Demanding n>=5,
 * 10 or 20 before letting it contradict the ladder moves recall 26.5% -> 26.5% -> 26.2% ->
 * 26.0%. MIN_COHORT_SAMPLES already applies; a further floor only removes signal.
 *
 * THIS WITHHOLDS, IT NEVER SUBSTITUTES. The FSA median is a poor estimator — on 473 Dupont
 * it says $2,500 against a reality near $3,100. Substituting it was measured directly and
 * made the tail WORSE, 1.13% -> 1.28% blow-ups. Disagreement tells us the ladder cannot be
 * trusted here; it does not tell us the right answer.
 */
export const RENT_DISAGREEMENT_CEILING = 0.5;

/**
 * |ln(ladder / secondOpinion)| — how far apart two independent cohorts put this property.
 *
 * Null whenever there is no second opinion to compare against, which must read as "do not
 * flag" for the same reason null quartiles do: every row predates 151 until the index is
 * rebuilt, and a signal that failed closed would blank the site.
 */
export function rentDisagreement(
  ladderRent: number | null | undefined,
  secondOpinionRent: number | null | undefined,
): number | null {
  if (!ladderRent || ladderRent <= 0) return null;
  if (!secondOpinionRent || secondOpinionRent <= 0) return null;
  return Math.abs(Math.log(ladderRent / secondOpinionRent));
}

/**
 * (p75 - p25) / median for a cohort, or null when the quartiles are unknown.
 *
 * NULL IS THE IMPORTANT CASE. Every `rental_market_index` row written before 150 carries
 * NULL quartiles, and so does every row if a future edit drops them from the INSERT. Null
 * must therefore mean "unknown, do not flag" rather than "wide" — a gate that fails closed
 * would blank the cap rate site-wide the moment the columns went missing, which is the
 * 148 failure mode wearing different clothes.
 */
export function rentDispersion(
  median: number | null | undefined,
  p25: number | null | undefined,
  p75: number | null | undefined,
): number | null {
  if (!median || median <= 0) return null;
  if (p25 == null || p75 == null) return null;
  if (!Number.isFinite(p25) || !Number.isFinite(p75)) return null;
  if (p75 < p25) return null; // transposed or corrupt; do not guess at the spread
  return (p75 - p25) / median;
}

/**
 * Decode the document's `rent_dispersion` into the argument rentTierConfidence() wants.
 *
 * The document stores -1 for "unknown" because 0 is a real and excellent reading. Every
 * reader needs that convention and none of them should restate it, so it lives here — a
 * surface that compared `rent_dispersion > 0.5` directly would work by accident today and
 * break the day someone stored null instead.
 */
export function readRentDispersion(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

/**
 * 'comp'  — the rent came from the subject's own neighbourhood or municipality at the
 *           subject's bath count. Safe to present as a property-level figure.
 * 'area'  — the rent is an area average: the sub-type, the bath count or the
 *           municipality was relaxed to find enough leases. Present it as an area
 *           figure, or keep it out of a headline number.
 * 'wide'  — a close cohort answered, but its own rents disagree too much for the median
 *           to describe this property (150). 18% of these are more than 50% wrong.
 *           Withhold the property-level number; the cohort is not evidence about one home.
 * 'none'  — no rent comp exists. The metric is absent, not zero.
 *
 * @param dispersion (p75-p25)/median for the cohort that answered — see rentDispersion().
 *   Omit it or pass null and the result is exactly the pre-150 behaviour, which is what
 *   keeps this safe to deploy before the index carries quartiles.
 */
export function rentTierConfidence(
  tier: string | null | undefined,
  dispersion?: number | null,
  disagreement?: number | null,
): RentConfidence {
  if (!tier) return 'none';
  const known = COMP_TIERS.has(tier) || AREA_TIERS.has(tier);
  // Both signals are only meaningful once we trust the rung. An unknown rung is already
  // unusable, and reporting it as 'wide' would claim we measured something we did not.
  //
  // EITHER fires, because they catch different listings: dispersion sees a cohort that
  // disagrees with itself, disagreement sees a cohort that agrees tightly around the
  // wrong number. Requiring both would collapse recall to the intersection.
  if (known) {
    if (dispersion != null && dispersion > RENT_DISPERSION_CEILING) return 'wide';
    if (disagreement != null && disagreement > RENT_DISAGREEMENT_CEILING) return 'wide';
  }
  if (COMP_TIERS.has(tier)) return 'comp';
  if (AREA_TIERS.has(tier)) return 'area';
  return 'none'; // unknown rung: treat as unusable rather than guess at its accuracy
}

/**
 * Whether a rent-derived figure must be WITHHELD because its cohort contradicts itself.
 *
 * TRUE ONLY FOR 'wide', and the narrowness is the point. The backtest behind 150 measured
 * one population: cohorts whose interquartile spread exceeds the ceiling. It says nothing
 * about a listing with no rung recorded — and 'none' does not mean "no comps" there.
 * `rent_match_tier` is also absent on any document not re-transformed since migration 124,
 * and those still carry a perfectly good cap_rate_est. Suppressing on 'none' would blank a
 * working figure on every stale document to fix a problem the measurement never found.
 *
 * Callers keep whatever they already did about a missing figure; this adds one reason to
 * hide one, and only the reason that was measured.
 */
export function rentSpreadTooWide(confidence: RentConfidence): boolean {
  return confidence === 'wide';
}

/** Short human label for the basis of a rent-derived figure. */
export function rentTierLabel(tier: string | null | undefined): string | null {
  switch (tier) {
    // The three size rungs (148). Absent here until 150, so the 68% of listings they
    // serve fell through to the caller's generic fallback and showed no tooltip.
    case 'nbhd_size': return 'Neighbourhood comps, same size and baths';
    case 'city_bath_size': return 'City comps, same size and baths';
    case 'city_size': return 'City comps, same size';
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
    case 'nbhd_size':
      return 'Based on rents for homes of a similar size in this neighbourhood, with the same number of bathrooms.';
    case 'city_bath_size':
      return 'Based on rents for homes of a similar size in this city, with the same number of bathrooms.';
    case 'city_size':
      return 'Based on rents for homes of a similar size in this city.';
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
 * The sentence a surface shows where it WITHHOLDS a rent-derived figure.
 *
 * Plain language, and specific about which of the two reasons applies — "we have nothing"
 * and "what we have contradicts itself" are different facts, and the second one is the
 * more useful thing to tell a reader who can see comps on the same page.
 *
 * Deliberately does not name a number. Quoting the spread would invite the reader to
 * average it themselves, which is the very estimate we just declined to publish.
 */
export function rentWithheldExplainer(confidence: RentConfidence): string | null {
  switch (confidence) {
    case 'wide':
      return 'Rents for comparable homes here vary too widely to estimate this one. We would rather show nothing than a figure this uncertain.';
    case 'none':
      return 'No comparable rents were found for this property, so rent-based figures are not shown.';
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
