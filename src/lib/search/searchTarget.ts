/**
 * Pure routing logic for the unified search bar. Classifies a chosen
 * suggestion (or free-typed text) into a mode-independent SearchTarget, and
 * renders a target into a route for navigate mode. No React / store / network —
 * the component decides how to APPLY a target (in-place store write vs router.push).
 */

import type { SearchSuggestion } from '@/lib/typesense/client';
import { parseAddress } from '@/lib/watchlist/disposition';
import { slugify, cityHubSlug } from '@/lib/listings/listingPath';

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

/**
 * Address-shaped text ("142 maplewood ave, hamilton") → its address-profile URL, else
 * null. The profile route runs the full resolution ladder (active → sold → geocode), so
 * sending an address there is always at least as good as a city search — a live listing
 * redirects to its listing page (ADDRESS_PROFILES_PLAN P4).
 */
export function addressProfileHref(label: string): string | null {
  const parsed = parseAddress(label);
  if (!parsed.streetNumber || !parsed.streetName) return null;
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean);
  const streetSlug = slugify(parts[0] ?? '');
  if (!streetSlug) return null;
  const citySlug = slugify(parts[1]?.replace(/\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b/g, '').trim() ?? '') || 'ontario';
  return `/address/on/${citySlug}/${streetSlug}`;
}

/**
 * Canonical KEYED /address URL for a sold/off-market record — the same shape the
 * addresses sitemap and the profile ladder's sold redirect emit, so every surface
 * lands on one URL per record.
 */
export function soldAddressHref(address: string, city: string, key: string): string {
  const citySlug = cityHubSlug(city) || slugify(city) || 'ontario';
  const streetSlug = slugify((address || '').split(',')[0]);
  return `/address/on/${citySlug}/${streetSlug ? `${streetSlug}-${key}` : key}`;
}

/** navigate-mode only: turn a target into a route into the terminal / listing / profile. */
export function targetToHref(t: SearchTarget): string {
  if (t.action === 'open-listing') return `/properties/${t.listing.id}`;
  return addressProfileHref(t.label) ?? `/properties?city=${encodeURIComponent(t.label)}`;
}
