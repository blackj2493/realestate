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
