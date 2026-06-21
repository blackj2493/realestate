/**
 * Descriptive listing URLs (Phase 1c). The canonical public path is
 *   /property/{prov}/{city}/{address-slug}-{LISTINGKEY}
 * e.g. /property/on/london/3380-singleton-avenue-107-X12639568
 *
 * The TRREB ListingKey is the STABLE TAIL and the only source of truth for lookups —
 * the descriptive slug is cosmetic. Duplicate addresses, unit numbers, and mid-listing
 * address changes therefore can't break resolution: we always parse the key off the end.
 */

const KEY_RE = /^[A-Z]\d{6,9}$/; // one board letter + 6-9 digits, e.g. X12639568

/** Lowercase, ASCII-fold, and dash-collapse a free-text segment for use in a URL. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumerics -> dash
    .replace(/^-+|-+$/g, "") // trim leading/trailing dashes
    .replace(/-{2,}/g, "-"); // collapse runs
}

/** Minimal payload shape needed to build a path. */
export interface ListingPathInput {
  ListingKey?: string | null;
  UnparsedAddress?: string | null;
  City?: string | null;
  StateOrProvince?: string | null;
}

/**
 * Build the canonical descriptive path for a listing, or null if there's no usable
 * ListingKey (the one field we cannot synthesize). City/province/address degrade to
 * safe fallbacks so a sparse payload still yields a valid, unique URL.
 */
export function buildListingPath(p: ListingPathInput): string | null {
  const key = (p.ListingKey || "").trim().toUpperCase();
  if (!KEY_RE.test(key)) return null;

  const prov = slugify(p.StateOrProvince || "ON") || "on";
  const city = slugify(p.City || "") || "on";
  const addr = slugify(p.UnparsedAddress || "");

  const tail = addr ? `${addr}-${key}` : key;
  return `/property/${prov}/${city}/${tail}`;
}

/**
 * Extract the ListingKey from a descriptive slug. Accepts either the catch-all
 * segment array (["on","london","3380-...-X12639568"]) or the raw last segment.
 * Case-insensitive; returns the canonical uppercase key, or null if none is present.
 */
export function extractListingKey(slug: string | string[]): string | null {
  const last = Array.isArray(slug) ? slug[slug.length - 1] : slug;
  if (!last) return null;
  // The key is the trailing token after the final dash (or the whole segment).
  const tail = last.includes("-") ? last.slice(last.lastIndexOf("-") + 1) : last;
  const key = tail.trim().toUpperCase();
  return KEY_RE.test(key) ? key : null;
}
