/**
 * Pure slug → address-text helpers for /address/{prov}/{city}/{slug}.
 *
 * Deliberately dependency-free (no Typesense, no next/cache, no Supabase) so the URL
 * parsing that decides WHICH home a page is about can be unit-tested on its own —
 * resolveProfile.ts pulls in server-only modules and cannot be imported from a test.
 */

/**
 * "142-maplewood-avenue" → "142 maplewood avenue" (lowercase working text).
 *
 * Restores the unit hyphen first. A slug flattens every hyphen to a space, so
 * "86-2945-thomas-street" arrives as "86 2945 thomas street" and the separator that
 * marked the unit becomes indistinguishable from the ones joining words. parseAddress
 * then reads civic number 86 on a street called "2945 Thomas Street" — an address that
 * exists nowhere, so the page matches nothing and never learns it is about unit 86.
 *
 * Two leading numbers followed by a word is the Ontario unit-civic pair; one leading
 * number is an ordinary civic address and is left untouched ("1234 highway 7").
 */
export function slugToStreetText(slug: string): string {
  const text = decodeURIComponent(slug).replace(/-/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return text.replace(/^(\d+[a-z]?)\s+(\d+[a-z]?)\s+(?=[a-z])/, "$1-$2 ");
}
