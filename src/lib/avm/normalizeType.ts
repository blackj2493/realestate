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
