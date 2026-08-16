/**
 * "Are these two rows the same physical home?" — one definition, shared.
 *
 * This is the join the whole relist story rests on. A terminated campaign and the listing
 * that replaces it are unrelated MLS keys; the feed carries no shared identifier, so the
 * address is the only thing tying them together. Both the server-side live-listing lookup
 * and the client-side campaign stacking must agree on it exactly, or a home's history
 * splits back into rows that look like separate houses.
 *
 * Deliberately STRICTER than the shared `addressesMatch`: that one treats equal postals as
 * proof and never looks at the street, which is fine for reconciling one listing against
 * candidates already scoped to its own address string, but not for a join fed by
 * typo-tolerant search. Here the civic number AND the street must agree, and the postal
 * (or city) only corroborates.
 */

import { parseAddress, streetNamesMatch, unitsMatch, type ParsedAddress } from "@/lib/watchlist/disposition";

/** Same home, from two parsed addresses. */
export function isSamePropertyParsed(a: ParsedAddress, b: ParsedAddress): boolean {
  if (!a.streetNumber || a.streetNumber !== b.streetNumber) return false;
  if (!streetNamesMatch(a.streetName, b.streetName)) return false;
  // The UNIT is load-bearing here, never optional. Every unit in a condo block shares one
  // civic number and one postal code, so without this 2945 Thomas St #62 and #86 collapse
  // into a single "home" — campaign stacking would fold one unit's history under another,
  // and the relist join would forward a visitor to the neighbour's live listing. This is
  // exactly the collapse `unit` was added to stop; a row that renders a per-home number
  // must never take the ignoreUnit shortcut.
  if (!unitsMatch(a, b)) return false;
  if (a.postal && b.postal) return a.postal === b.postal;
  return !!a.city && a.city === b.city;
}

/** Same home, from two raw address strings ("90 Osler Drive, Hamilton, ON L9H 4B5"). */
export function isSameProperty(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return isSamePropertyParsed(parseAddress(a), parseAddress(b));
}

/**
 * Fold rows that describe the SAME home into one group: the first row for an address
 * leads, the rest become its history. Callers order the input so the row they want as
 * lead comes first (a live listing ahead of the campaigns that preceded it).
 *
 * Generic over the row type because the two search bars carry different shapes — and
 * because the last time only one of them learned something, they disagreed about the same
 * query for weeks.
 */
export function groupByProperty<T>(
  items: T[],
  addressOf: (item: T) => string | undefined | null
): Array<{ lead: T; history: T[] }> {
  const groups: Array<{ lead: T; history: T[] }> = [];
  for (const item of items) {
    const group = groups.find((g) => isSameProperty(addressOf(g.lead), addressOf(item)));
    if (group) group.history.push(item);
    else groups.push({ lead: item, history: [] });
  }
  return groups;
}
