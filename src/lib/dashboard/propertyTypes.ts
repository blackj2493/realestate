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
 * Parse property-type option keys from a market-endpoint request. Accepts the
 * multi-select `types=detached,condo` form and falls back to the legacy single
 * `propertyType=detached`. "all"/empty ⇒ [] (no type filter). Unknown keys are
 * dropped (variantsForKeys ignores them anyway).
 */
export function parseTypeKeys(params: URLSearchParams): string[] {
  const multi = (params.get('types') || '').trim();
  if (multi) {
    return multi
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k && k !== 'all' && BY_KEY.has(k));
  }
  const single = (params.get('propertyType') || '').trim().toLowerCase();
  return single && single !== 'all' && BY_KEY.has(single) ? [single] : [];
}

/**
 * The reverse map: a raw PropertySubType ("Att/Row/Townhouse", "Semi-Detached ") →
 * the option key the market endpoints filter on ("town", "semi"). Exact variant match
 * first (authoritative), then a spelling-tolerant fallback for feed values not in the
 * registry (e.g. "Detached Condo Apartment"). Returns null when nothing matches, which
 * callers must read as "no type filter" rather than guessing.
 *
 * Order in the fallback matters: "semi" before "detached", "town" before "condo"
 * (a Condo Townhouse is a townhouse) — same precedence as normalizePropertySubType.
 */
export function typeKeyForSubType(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  for (const opt of PROPERTY_TYPE_OPTIONS) {
    if (opt.variants.some((v) => v.trim().toLowerCase() === lower)) return opt.key;
  }
  if (lower.includes('semi')) return 'semi';
  if (lower.includes('town')) return 'town';
  if (lower.includes('detached')) return 'detached';
  if (lower.includes('link')) return 'link';
  if (/condo|apartment|apt|co-?op|co-ownership/.test(lower)) return 'condo';
  if (/duplex|triplex|fourplex|multiplex/.test(lower)) return 'multiplex';
  return null;
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

/**
 * Sub-types with no home on them. No option offers them, so they reach the dashboard only
 * when no type is picked: a $125k parking space led "Lowest Capital Burn" that way.
 */
export const NON_HOME_SUBTYPES = ['Parking Space', 'Locker', 'Timeshare'] as const;

/**
 * Commercial sub-types, for the sold collection, which has no PropertyType field. "Farm"
 * and "Store W Apt/Office" are left out: the feed files most of them as residential.
 */
export const COMMERCIAL_SUBTYPES = [
  'Sale Of Business',
  'Commercial Retail',
  'Industrial',
  'Investment',
  'Office',
  'Land',
] as const;

const notIn = (field: string, values: readonly string[]) =>
  `${field}:!=[${values.map((v) => `\`${v}\``).join(',')}]`;

/**
 * The dashboard shows HOMES. With no type picked, the active index let commercial in —
 * 12% of sale and 27% of lease listings — so "New" counted storefronts that "Sold" (a
 * residential feed) never does, and "Sale Of Business" filled the top 8 rows of "Lowest
 * Capital Burn" in Toronto. Same exclusion the city hubs use (PropertyType:!=Commercial).
 *
 * Only for an empty pick: a picked type is a positive sub-type list that already excludes
 * all of these, and the "Vacant Land" option needs the commercial-class "Land" sub-type.
 */
export function homesOnlyClause(keys: readonly string[]): string | undefined {
  if (keys.length > 0) return undefined;
  return `PropertyType:!=Commercial && ${notIn('PropertySubType', NON_HOME_SUBTYPES)}`;
}

/** The sold-collection twin of homesOnlyClause (that collection has no PropertyType). */
export function soldHomesOnlyClause(keys: readonly string[]): string | undefined {
  if (keys.length > 0) return undefined;
  return notIn('PropertySubType', [...COMMERCIAL_SUBTYPES, ...NON_HOME_SUBTYPES]);
}
