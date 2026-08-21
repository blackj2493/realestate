/**
 * "Does this home HAVE a rentable in-home suite today?" — the gate on suite income
 * entering a published metric (migration 125).
 *
 * The distinction that matters is OBSERVED vs SCORED. A cap rate measures what the
 * asset produces in its current physical configuration. A second kitchen is physical.
 * A score is a plan. Publishing a plan's income as a cap rate is how the 1.6x
 * multiplier came to sit on 102,285 listings, 83,882 of which have no second kitchen.
 *
 * Measured over the 189,165 active for-sale listings on 2026-08-21, by the first
 * trigger that fires in calculateMultiUnitPotential's EXISTING_MULTI_UNIT branch:
 *
 *   plex sub-type (Duplex/Triplex/...)        2,843   the rent comp IS the plex —
 *                                                     adding a suite line double counts
 *   KitchensBelowGrade > 0                   17,602   observed, counted
 *   Basement 'Apartment', no kitchen field    1,097   observed, counted
 *   PublicRemarks regex only                  3,349   NOT counted
 *
 * The remarks trigger decides itself: 3,187 of its 3,349 hits are the phrase "in-law
 * suite", which is family accommodation, not rent. "currently rented" (148) is just as
 * likely to describe the whole house. There is no safe income signal in prose.
 *
 * Total counted: 18,699.
 *
 * NOT a claim that the suite is legal, occupied, or separately metered. Every surface
 * that shows this income must say so, and must let the reader zero it.
 */

/** Sub-types whose own rent comp already covers every unit in the building. */
const PLEX_SUB_TYPES = new Set(['Duplex', 'Triplex', 'Multiplex', 'Fourplex']);

export interface ObservedSuiteInput {
  PropertyType?: string | null;
  PropertySubType?: string | null;
  CondoCorpNumber?: string | number | null;
  KitchensBelowGrade?: number | string | null;
  Basement?: unknown;
}

/** True when the FEED states a second dwelling exists inside a single-family house. */
export function hasObservedSuite(listing: ObservedSuiteInput): boolean {
  const subType = (listing.PropertySubType ?? '').toString().trim();
  const propertyType = (listing.PropertyType ?? '').toString();

  // Strata killswitch, same order calculateMultiUnitPotential uses: a condo cannot
  // hold a secondary suite, whatever else the fields say.
  if (propertyType.includes('Condo') || listing.CondoCorpNumber || subType === 'Condo Townhouse') {
    return false;
  }
  // A plex's whole-home comp is a plex comp. Suite income on top charges twice.
  if (PLEX_SUB_TYPES.has(subType)) return false;

  const kitchens = Number(listing.KitchensBelowGrade ?? 0);
  if (Number.isFinite(kitchens) && kitchens > 0) return true;

  const basement = listing.Basement;
  if (Array.isArray(basement)) {
    return basement.some((b) => typeof b === 'string' && b.toLowerCase().includes('apartment'));
  }
  return false;
}
