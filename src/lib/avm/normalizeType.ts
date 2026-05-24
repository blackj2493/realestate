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
