/**
 * Property-type filter registry for the dashboard Market Activity panel.
 *
 * Maps the consumer-facing labels (the mockup checkbox set) to the EXACT
 * PropertySubType spellings used by BOTH feeds. The Typesense `properties`
 * collection and Supabase `raw_vow_sold.property_sub_type` were verified to use
 * the SAME verbatim TRREB spellings — including the trailing-space quirk on
 * "Semi-Detached " and slashes in "Att/Row/Townhouse" — so one variant list per
 * option drives both sides. (cf. rawVariantsOf() in src/lib/avm/normalizeType.ts,
 * which documents the same trailing-space quirk for the AVM anchor pool.)
 *
 * IMPORTANT: spellings contain spaces/slashes/trailing-space, so Typesense
 * filter values MUST be backtick-quoted (`PropertySubType:=`value``) and Supabase
 * matching MUST be exact `.in()` (not ilike) so the trailing space is preserved.
 */

export interface PropertyTypeOption {
  /** stable key persisted in the lens config */
  key: string;
  /** consumer label shown in the checkbox UI */
  label: string;
  /** exact PropertySubType spellings (both feeds) */
  variants: string[];
}

export const PROPERTY_TYPE_OPTIONS: PropertyTypeOption[] = [
  { key: 'detached', label: 'Detached', variants: ['Detached', 'Detached Condo'] },
  {
    key: 'semi',
    label: 'Semi-Detached',
    // "Semi-Detached " carries a trailing space in prod (both feeds).
    variants: ['Semi-Detached', 'Semi-Detached ', 'Semi-Detached Condo'],
  },
  {
    key: 'town',
    label: 'Townhouse',
    variants: ['Att/Row/Townhouse', 'Condo Townhouse', 'Attached/Row/Street Townhouse'],
  },
  {
    key: 'condo',
    label: 'Condo Apt',
    variants: [
      'Condo Apartment',
      'Co-op Apartment',
      'Co-Ownership Apartment',
      'Common Element Condo',
      'Leasehold Condo',
    ],
  },
  { key: 'link', label: 'Link', variants: ['Link'] },
  {
    key: 'multiplex',
    label: 'Multiplex',
    variants: ['Multiplex', 'Duplex', 'Triplex', 'Fourplex'],
  },
  {
    key: 'vacant',
    label: 'Vacant Land',
    variants: ['Vacant Land', 'Land', 'Vacant Land Condo'],
  },
];

const BY_KEY = new Map(PROPERTY_TYPE_OPTIONS.map((o) => [o.key, o]));

/** Flatten the selected option keys to the union of their PropertySubType variants. */
export function variantsForKeys(keys: string[]): string[] {
  if (!keys || keys.length === 0) return [];
  const out: string[] = [];
  for (const k of keys) {
    const opt = BY_KEY.get(k);
    if (!opt) continue;
    for (const v of opt.variants) if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Typesense filter_by clause for the selected property types, backtick-quoted.
 * Returns undefined when nothing is selected (= all types).
 */
export function typesensePropertyTypeClause(keys: string[]): string | undefined {
  const variants = variantsForKeys(keys);
  if (variants.length === 0) return undefined;
  const ors = variants.map((v) => `PropertySubType:=\`${v.replace(/`/g, '')}\``);
  return `(${ors.join(' || ')})`;
}
