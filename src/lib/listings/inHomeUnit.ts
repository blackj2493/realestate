/**
 * In-home rental unit detector — the single definition of "this lease is a PART of a
 * house", shared by the address-profile rents grid and the rent-ladder ETL.
 *
 * It lived inside src/lib/address/nearbyForSale.ts, where only the grid could reach
 * it. That is why the two pipelines disagreed for a year: the grid separated basement
 * leases into their own row, and refreshRentalMarketIndex.ts — which never selected
 * UnparsedAddress — folded them straight into the whole-home cohorts that feed
 * cap_rate_est. Measured 2026-08-21: 10,756 of 89,685 active for-lease listings (12.0%)
 * are in-home units, and removing them moves 410 house cohorts by 1% or more, the
 * worst by 72%.
 *
 * Original tuning note (owner-reported 2026-07-24): Brampton's "Detached 3bd" median
 * read $1,975 because basements were listed AS Detached — "41 Eberly Woods Drive
 * Basement $2,000", "6 Sweet Briar Lane Bsmt $1,700", "106 Benadir Avenue #bsmnt
 * $1,900". The markers are tuned against real feed strings:
 *  - "basement"/"bsmt"/"#bsmnt"/"walk-out" anywhere (never street names);
 *  - lower/upper/main ONLY in unit positions — parenthesized "(Lower Unit)", after a
 *    dash "B - Upper", before level/floor/unit/apt/suite, or trailing ("… St Upper")
 *    — so "Upper Canada Drive", "Lower Base Line" and "Main Street" never match.
 * Known miss: bare numeric units ("3407 Woodroffe Avenue 2") — no safe signal.
 */

const PARTIAL_UNIT_RE = new RegExp(
  [
    /\b(?:bsmn?t|basement|walk\s*-?\s*out)\b/.source,
    /#\s*(?:bsmn?t|basement)/.source,
    /\([^)]*\b(?:lower|upper|main|bsmn?t|basement)\b[^)]*\)/.source,
    /-\s*(?:lower|upper|main)\b/.source,
    /\b(?:lower|upper|main)\s+(?:level|floor|unit|apt|apartment|suite)\b/.source,
    /\b(?:lower|upper|main)\s*(?:$|,)/.source,
  ].join("|"),
  "i"
);

/** Whole-listing subtypes that ARE in-home units — folded into the same row. */
const IN_HOME_SUBTYPES = new Set(["lower level", "upper level"]);

export const IN_HOME_UNIT_LABEL = "Basement / in-home unit";

/** True when a rental is a PART of a house (basement/upper/main-floor unit). */
export function isPartialUnitRental(
  address: string | null | undefined,
  subType?: string | null
): boolean {
  if (subType && IN_HOME_SUBTYPES.has(subType.trim().toLowerCase())) return true;
  return !!address && PARTIAL_UNIT_RE.test(address);
}
