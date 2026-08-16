/**
 * Default property-type selection for the address-profile "If <address> listed today"
 * band (UX audit #16).
 *
 * The band's tabs are the top-2 nearby ACTIVE property types by inventory count
 * (see getNearbyForSale → typeMix). In a condo-dense pocket that makes "Condo
 * Apartment" the count-leader — so the band opened on condo even for a detached
 * house on a street of houses. These helpers pick the initial tab from the SUBJECT's
 * likely type instead of raw nearby inventory:
 *
 *   1. the street's dominant recorded type (`hint`, when we could derive one), else
 *   2. the most common NON-condo band, else
 *   3. the count-leader (index 0) — everything nearby genuinely is a condo.
 *
 * Pure + React-free so it's shared by IfListedToday (initial tab) and
 * AddressProfileView (deriving the hint) and unit-tested without a DOM.
 */

/** Condo/co-op ownership forms — "Condo Apartment", "Condo Townhouse", "Co-Op
 *  Apartment", "Vacant Land Condo", … . Freehold houses (Detached, Semi-Detached,
 *  Att/Row/Townhouse, Link, Duplex, …) are NOT condo-like. */
export function isCondoLike(label: string): boolean {
  return /condo|apartment|co-?op/i.test(label);
}

/** The most frequently occurring non-empty subtype, or null when there are none.
 *  Ties resolve to the first subtype seen (callers pass rows newest/nearest-first). */
export function dominantSubType(subTypes: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const s of subTypes) {
    const v = (s ?? "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [label, n] of counts) {
    if (n > bestN) {
      best = label;
      bestN = n;
    }
  }
  return best;
}

/**
 * Which band tab to open on. `hint` is the subject street's dominant type (from the
 * sold ledger for members, or same-street live listings) — null when we couldn't
 * derive one. Implements the priority in this module's header.
 */
export function pickDefaultBandIndex(bandLabels: string[], hint: string | null | undefined): number {
  if (bandLabels.length === 0) return 0;
  const norm = (s: string) => s.trim().toLowerCase();

  if (hint && hint.trim()) {
    // 1. The street's dominant type is itself one of the bands.
    const exact = bandLabels.findIndex((l) => norm(l) === norm(hint));
    if (exact >= 0) return exact;
    // 2. Same ownership family (condo-like vs freehold house) as the street's type —
    //    e.g. a "Semi-Detached" street lands on the "Detached" band, not a condo.
    const hintCondo = isCondoLike(hint);
    const family = bandLabels.findIndex((l) => isCondoLike(l) === hintCondo);
    if (family >= 0) return family;
  }

  // 3. No usable hint → the most common non-condo type (bands are count-sorted).
  const nonCondo = bandLabels.findIndex((l) => !isCondoLike(l));
  if (nonCondo >= 0) return nonCondo;

  // 4. Everything nearby is a condo → keep the count-leader.
  return 0;
}
