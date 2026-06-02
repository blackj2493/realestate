/**
 * Pure routing logic for the unified search bar. Classifies a chosen
 * suggestion (or free-typed text) into a mode-independent SearchTarget, and
 * renders a target into a route for navigate mode. No React / store / network —
 * the component decides how to APPLY a target (in-place store write vs router.push).
 */

import type { SearchSuggestion } from '@/lib/typesense/client';

export type SearchTarget =
  | { action: 'open-listing'; listing: NonNullable<SearchSuggestion['listing']> }
  | { action: 'set-location'; label: string };

/** A chosen suggestion: address/MLS with a listing opens it; everything else is a place. */
export function resolveSuggestionTarget(s: SearchSuggestion): SearchTarget {
  if ((s.kind === 'address' || s.kind === 'mls') && s.listing) {
    return { action: 'open-listing', listing: s.listing };
  }
  return { action: 'set-location', label: s.label.trim() };
}

/** Free-typed text (no suggestion chosen) is always a location search. */
export function resolveTextTarget(text: string): SearchTarget {
  return { action: 'set-location', label: text.trim() };
}

/** navigate-mode only: turn a target into a route into the terminal / listing. */
export function targetToHref(t: SearchTarget): string {
  return t.action === 'open-listing'
    ? `/properties/${t.listing.id}`
    : `/properties?city=${encodeURIComponent(t.label)}`;
}
