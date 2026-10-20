/**
 * Sub-type family — the pooling rule for the rent index's `city_family` rung.
 *
 * When a city has leases but none of the subject's exact PropertySubType, the lookup
 * relaxes the SUB-TYPE while holding the geography, rather than the other way round.
 * Location dominates rent, so a Toronto townhouse borrowing from Toronto freehold
 * stock beats it borrowing from a townhouse two counties away.
 *
 * ONE definition, imported by both the index builder (rentModel) and the lookup
 * (rentAVM). They must agree exactly — when the two sides disagreed about a trailing
 * space in "Semi-Detached ", 4,775 listings silently lost their rent estimate.
 *
 * THE SPLIT IS MEASURED, NOT ASSUMED. This exact rule — condo-ish vs everything else
 * — is what produced 13.17% median / 42.9% p90 leave-one-out error on the 8,368
 * listings that land on this rung, which is at parity with the `city` rung already in
 * production (13.73% / 47.6%). Change the rule and that evidence no longer applies;
 * re-run the coverage harness before you do.
 *
 * NULL means "do not pool this one at all". Land, farm, parking and the commercial
 * sub-types have no residential rent, and pooling would let a vacant lot inherit a
 * house's rent — a fabricated number of exactly the kind the no-rent guard in
 * financialMetrics exists to prevent.
 */

export type SubTypeFamily = 'condo' | 'freehold';

/**
 * Sub-types that must never receive a pooled rent. "Vacant Land Condo" is listed
 * explicitly because it would otherwise match the condo test below.
 */
const NON_RENTABLE: ReadonlySet<string> = new Set([
  'Vacant Land',
  'Vacant Land Condo',
  'Land',
  'Farm',
  'Parking Space',
  'Timeshare',
  'Sale Of Business',
  'Commercial Retail',
  'Commercial',
  'Office',
  'Industrial',
  'Investment',
  'Store W Apt/Office',
]);

/**
 * The family a sub-type pools into, or null when it must not pool.
 * Trims first: the feed ships "Semi-Detached " with a trailing space.
 */
/**
 * Homes that DO rent, but that no other family may stand in for.
 *
 * Pooling exists so a thin cohort can borrow a comparable one. That is legitimate only
 * where the types ARE comparable, and these are not: a mobile or modular home sits on
 * LEASED land, depreciates rather than appreciates, and its price buys the structure
 * alone while a house's rent covers structure plus land. Pooling them compares two
 * different assets.
 *
 * Not a rare edge. Measured 2026-09-01, EVERY MobileTrailer and Modular Home carrying a
 * rent comp — 827 of them — got it from the pooled `city_family` rung, and not one has a
 * cohort of its own. Each was priced at the median rent of DETACHED HOUSES across its
 * city, which is how a $22,900 trailer published a 108% cap rate. They are 196 of the
 * 300 listings sitting above the 15% sanity band.
 *
 * `Other` is deliberately absent: 120 of its listings do form exact-sub-type cohorts,
 * so it is at least matching itself.
 *
 * The right answer here is no comp until a real cohort exists. A park's rents are
 * knowable; a detached house's rents are not a substitute for them.
 */
const NO_COMPARABLE_FAMILY: ReadonlySet<string> = new Set([
  'MobileTrailer',
  'Modular Home',
]);

export function subTypeFamily(subType: string | null | undefined): SubTypeFamily | null {
  const st = (subType ?? '').trim();
  if (!st || NON_RENTABLE.has(st) || NO_COMPARABLE_FAMILY.has(st)) return null;
  return /condo|co-ownership/i.test(st) ? 'condo' : 'freehold';
}

/**
 * True when a sub-type can carry a residential rent estimate at all.
 *
 * Must NOT be `subTypeFamily(...) !== null`, which is what it was. Since null now has
 * two causes — nothing to rent, and nothing comparable — deriving it that way would bar
 * a mobile home from the nbhd / city_bath / city / county rungs that key on its EXACT
 * sub-type. Those are precisely where its honest comp will come from once one exists.
 */
export function isRentableSubType(subType: string | null | undefined): boolean {
  const st = (subType ?? '').trim();
  return st.length > 0 && !NON_RENTABLE.has(st);
}
