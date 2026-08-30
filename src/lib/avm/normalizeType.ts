/**
 * Property-type normalization shared by the AVM lookups.
 *
 * The matrix/audit CSVs are keyed by a NORMALIZED type (one of four canonical
 * values). raw_vow_sold stores the verbatim TRREB spellings, which include data
 * quirks (notably a trailing space on "Semi-Detached "). So we decouple:
 *   • normalizePropertySubType() collapses any raw/live spelling to the canonical
 *     key used for the matrix + audit lookups.
 *   • rawVariantsOf() returns the EXACT raw_vow_sold spellings to pool when
 *     computing the live 90-day anchor, so the anchor population matches the
 *     model's training group (and Base_Price).
 *
 * Raw spellings verified against prod raw_vow_sold (≈217k rows).
 * CLAUDE.md §4: deterministic, no AI.
 */

export type NormalizedType =
  | 'Detached'
  | 'Semi-Detached'
  | 'Townhouse'
  | 'Condo Apartment';

const CANONICAL: readonly string[] = [
  'Detached',
  'Semi-Detached',
  'Townhouse',
  'Condo Apartment',
];

/**
 * True when a normalized type is one of the four canonical dwelling types the AVM
 * is actually built for.
 */
export function isCanonicalSubType(normalized: string): boolean {
  return CANONICAL.includes(normalized);
}

/**
 * Types the comp-based dwelling AVM prices VERY poorly (backtest: 30–67% median
 * error) because they are land, non-dwelling, or income properties valued on a
 * different basis (cap rate, buildable area) than residential comps:
 *   Vacant Land, Farm, Rural Residential, Mobile/Trailer, Parking Space, Locker,
 *   Sale Of Business, Triplex/Fourplex/Multiplex — plus the Commercial-class
 *   subtypes (Office, Commercial Retail, Industrial, Investment, Store W
 *   Apt/Office, Land): the model is trained on dwellings only, so a commercial
 *   "estimate" would be pure out-of-distribution noise (commercial-gap Phase 0).
 * NOTE: deliberately EXCLUDES Link (backtest 6% median — excellent), Duplex
 * (≈unbiased), Co-op/Co-Ownership (normalize to Condo Apartment), and Modular —
 * those are priceable and must keep publishing. Matched on the verbatim spelling.
 */
/**
 * EXPORTED (with UNPRICEABLE_EXACT) so callers that must express this predicate in SQL —
 * the data-health canary's count_unpriceable_valued_estimates RPC — pass these arrays as
 * parameters instead of keeping a drifted copy. refresh-property-estimates.ts carried its
 * own private list for ~2 months; it missed Farm/Investment/'MobileTrailer' and that drift
 * class is exactly how 1,346 stale dwelling-model values survived on land/commercial rows.
 * THIS file is the single source of truth for what the AVM refuses to price.
 */
export const UNPRICEABLE_PATTERNS: readonly string[] = [
  'vacant',
  'farm',
  'rural resid',
  'mobile',
  'trailer',
  'parking',
  'locker',
  'sale of business',
  'triplex',
  'fourplex',
  'multiplex',
  // Commercial-class subtypes (fundamentals.ts COMMERCIAL_TYPE_OPTIONS)
  'office',
  'retail',
  'industrial',
  'investment',
  'commercial',
];

/** Exact-match unpriceable subtypes (substring would false-trip: Highland, Island …). */
export const UNPRICEABLE_EXACT: readonly string[] = ['land'];

export function isUnpriceableType(rawSubType: string | null | undefined): boolean {
  const s = (rawSubType ?? '').trim().toLowerCase();
  if (!s) return false;
  if (UNPRICEABLE_EXACT.includes(s)) return true;
  return UNPRICEABLE_PATTERNS.some((p) => s.includes(p));
}

/**
 * Collapse a raw/live PropertySubType to the canonical lookup key. Unknown types
 * fall through to the trimmed verbatim string (→ matrix/audit miss → anchor-only).
 * Order matters: "semi" before "detached"; "town" before "condo" (Condo Townhouse
 * is a townhouse).
 */
export function normalizePropertySubType(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('semi')) return 'Semi-Detached';
  if (s.includes('town')) return 'Townhouse';
  if (s.includes('detached')) return 'Detached';
  if (
    s.includes('condo') ||
    s.includes('apartment') ||
    s.includes('apt') ||
    s.includes('co-op') ||
    s.includes('co-ownership')
  ) {
    return 'Condo Apartment';
  }
  return (raw ?? '').trim();
}

// Exact raw_vow_sold spellings per canonical type. "Semi-Detached " carries a
// trailing space in prod; both forms are listed so the exact-match .in() filter
// catches it. The extra Townhouse spellings are future-proofing (harmless in .in()).
const RAW_VARIANTS: Record<NormalizedType, string[]> = {
  Detached: ['Detached'],
  'Semi-Detached': ['Semi-Detached', 'Semi-Detached ', 'Semi-Detached Condo'],
  Townhouse: [
    'Att/Row/Townhouse',
    'Condo Townhouse',
    'Attached/Row/Street Townhouse',
    'Townhouse',
  ],
  'Condo Apartment': ['Condo Apartment'],
};

/**
 * Postal FSA (forward sortation area) — the first three characters, e.g. "N2H".
 * '' when absent or malformed.
 *
 * This is the comp-cohort key for subjects whose feed carries NO CityRegion: all of
 * Waterloo Region and Brantford ship it blank on BOTH the active and the sold side,
 * so the community rung has no key to join on. The FSA is 100% populated on both
 * sides there and is neighbourhood-scale, not municipality-scale — Kitchener's 18
 * FSAs carry 50–347 sales each per year, denser than many Toronto communities that
 * price fine today.
 *
 * MUST stay byte-identical to sold_fsa_comps' predicate (migration 112),
 * `upper(left(btrim(postal_code), 3))`, or the RPC and its caller disagree about
 * which cohort a subject belongs to. The shape guard is the one addition: a key that
 * isn't letter-digit-letter is junk, and returning '' makes the caller skip the rung
 * rather than query for garbage.
 */
export function fsaOf(postalCode: string | null | undefined): string {
  const fsa = (postalCode ?? '').trim().toUpperCase().slice(0, 3);
  return /^[A-Z]\d[A-Z]$/.test(fsa) ? fsa : '';
}

/**
 * The raw_vow_sold spellings to pool for the live anchor of a normalized type.
 * Unknown types fall back to the listing's own raw spelling (best effort).
 */
export function rawVariantsOf(normalized: string, rawFallback?: string | null): string[] {
  if (CANONICAL.includes(normalized)) {
    return RAW_VARIANTS[normalized as NormalizedType];
  }
  const fb = (rawFallback ?? normalized ?? '').trim();
  return fb ? [fb] : [];
}

/**
 * Candidate `city_region` strings to try when matching matrices/audit/offset rows
 * to a listing or raw_vow_sold record. See memory `avm-matrix-city-region-prefix`
 * for the full reason: the matrix/audit CSVs are stored verbatim from source and
 * MIX clean ("Brampton East", "Bedford Park-Nortown") with legacy prefixed forms
 * ("1001 - BR Bronte", "3104 - CFB Rockcliffe and Area", "7709 - Barrhaven -
 * Strandherd"), while `raw_vow_sold.city_region` is the clean TRREB CityRegion.
 * `.ilike(key)` with no wildcards is case-insensitive `.eq` → prefixed cohorts
 * silently miss in production. The 2–3-letter "tag" is ambiguous (BR/OO are tags,
 * CFB is part of a name), so we cannot strip with one rule — we try multiple
 * candidate spellings and let whichever matches win.
 *
 * Order: [verbatim, strip-leading-number, strip-leading-number-plus-2-3-letter-tag].
 * Duplicates and empty strings are removed.
 */
export function cityRegionLookupCandidates(cityRegion: string): string[] {
  const v = (cityRegion ?? '').trim();
  if (!v) return [];
  const out: string[] = [v];
  const stripNum = v.replace(/^\d+\s*-\s*/, '').trim();
  if (stripNum && stripNum !== v) out.push(stripNum);
  const stripNumTag = v.replace(/^\d+\s*-\s*[A-Z]{1,3}\s+/, '').trim();
  if (stripNumTag && stripNumTag !== v && stripNumTag !== stripNum) out.push(stripNumTag);
  return out;
}
