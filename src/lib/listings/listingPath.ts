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

/**
 * Clean municipality name for the URL. TRREB encodes Toronto as "Toronto C06" /
 * "Toronto W01" / "Toronto E04" (codes nobody searches for) and uses directional area
 * suffixes for some cities ("London South" / "North" / "East"). Strip both so each city's
 * listings consolidate under one slug (/toronto, /london). Other cities (Mississauga,
 * Brampton, …) have no suffix and pass through unchanged. No Ontario municipality ends in
 * a bare cardinal direction, so the directional strip is safe.
 */
function municipality(city: string): string {
  return city
    .replace(/\s+[CEW]\d{2}\s*$/i, "")
    .replace(/\s+(North|South|East|West)\s*$/i, "")
    .trim();
}

/** Minimal payload shape needed to build a path. */
export interface ListingPathInput {
  ListingKey?: string | null;
  // Structured street fields (preferred — yield a clean street-only slug).
  StreetNumber?: string | null;
  StreetName?: string | null;
  StreetSuffix?: string | null;
  StreetDirPrefix?: string | null;
  StreetDirSuffix?: string | null;
  UnitNumber?: string | null;
  ApartmentNumber?: string | null;
  // Fallback only — the FULL address (street + city + prov + postal), so it must be
  // trimmed to the street portion before use or the slug duplicates city/prov/postal.
  UnparsedAddress?: string | null;
  City?: string | null;
  StateOrProvince?: string | null;
}

/**
 * Street-only address for the slug. Prefers the structured TRREB fields (so the slug is
 * e.g. "31-tippett-rd-607", NOT "31-tippett-rd-607-toronto-c06-on-m3h-0c8"). Falls back
 * to the part of UnparsedAddress before the first comma when structured fields are absent.
 */
function streetAddress(p: ListingPathInput): string {
  const street = [p.StreetDirPrefix, p.StreetNumber, p.StreetName, p.StreetSuffix, p.StreetDirSuffix]
    .map((x) => (x ?? "").toString().trim())
    .filter(Boolean)
    .join(" ");
  const unit = (p.UnitNumber || p.ApartmentNumber || "").toString().trim();
  if (street) return unit ? `${street} ${unit}` : street;

  const ua = (p.UnparsedAddress ?? "").toString();
  return ua.includes(",") ? ua.split(",")[0] : ua; // best-effort street slice
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
  const city = slugify(municipality(p.City || "")) || "on";
  const addr = slugify(streetAddress(p));

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

// ── City hubs (Phase 2) ────────────────────────────────────────────────────────

/** URL city slug → candidate TRREB City value, e.g. "richmond-hill" → "Richmond Hill". */
export function deslugCity(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** TRREB City value → hub URL slug (district code stripped): "Toronto C06" → "toronto". */
export function cityHubSlug(city: string): string {
  return slugify(municipality(city));
}

/**
 * Does this City value map to a usable hub? With Phase 2b-ii's facet-grouping resolution
 * (cityHubs.ts), every real city resolves — including district-split ones (Toronto C0x →
 * /toronto) and period-cities (St. Catharines) — so this is simply "yields a non-empty
 * slug". Gates the listing-page breadcrumb crawl link.
 */
export function cityHubResolves(city: string): boolean {
  return cityHubSlug(city).length > 0;
}
