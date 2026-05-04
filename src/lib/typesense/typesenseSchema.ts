/**
 * Shadow MLS - Typesense Schema Definition (Phase 1)
 * 
 * "Filterable Core" - Indexed fields for UI sliders, toggles, and sort dropdowns.
 * Unindexed Cargo - Heavy text/media for UI rendering only (index: false to protect RAM).
 * 
 * This schema is optimized for high-speed, in-memory search to bypass real estate board
 * rate limits and slow Postgres queries.
 */

/**
 * Indexed Core Fields (Faceted & Searchable)
 * These fields are actively used in UI filters and sort controls.
 */
export interface IndexedField {
  name: string;
  type: string;
  facet?: boolean;
  sort?: boolean;
}

export const indexedFields: IndexedField[] = [
  // Identity
  { name: 'id', type: 'string', facet: false },
  { name: 'listing_key', type: 'string', facet: false },
  
  // Price
  { name: 'list_price', type: 'int32', facet: true, sort: true },
  
  // Property Classification
  { name: 'property_type', type: 'string', facet: true },
  { name: 'property_sub_type', type: 'string', facet: true },
  
  // Bedrooms / Bathrooms / Parking
  { name: 'bedrooms', type: 'int32', facet: true, sort: true },
  { name: 'bathrooms', type: 'int32', facet: true, sort: true },
  { name: 'parking', type: 'int32', facet: true, sort: true },
  
  // Location (for city/region dropdowns)
  { name: 'city', type: 'string', facet: true },
  { name: 'city_region', type: 'string', facet: true },
  { name: 'postal_code', type: 'string', facet: true },
  
  // Basement & Kitchens (multi-select faceting)
  { name: 'basement_type', type: 'string[]', facet: true },
  { name: 'kitchens', type: 'int32', facet: true },
  
  // Lot Dimensions (for investor lot-size sliders)
  { name: 'lot_width', type: 'float', facet: true, sort: true },
  { name: 'lot_depth', type: 'float', facet: true, sort: true },
  { name: 'lot_sqft_total', type: 'float', facet: true, sort: true },
  
  // ─── Extrapolated Cap Rate (Phase 3) ───────────────────────────────────────
  // Pro Forma metrics for value-add analysis (facet: true, sort: true for "Highest Yield" sort)
  { name: 'total_capital_basis', type: 'float', facet: true, sort: true },
  { name: 'extrapolated_cap_rate', type: 'float', facet: true, sort: true },
  { name: 'capital_burn_rate_monthly', type: 'float', facet: true, sort: true },
  
  // ─── Temporal Distress (Phase 4) ───────────────────────────────────────
  // True DOM metrics for entity resolution and stale inventory detection
  { name: 'true_dom', type: 'int32', facet: true, sort: true },
  { name: 'total_price_drop', type: 'int32', sort: true },
  
  // Status & Age
  { name: 'status', type: 'string', facet: true },
  { name: 'approx_age', type: 'string', facet: true },
  
  // Timestamp for fast sorting by entry date
  { name: 'entry_timestamp', type: 'int64', sort: true },
  
  // Geolocation (for map viewport queries)
  { name: 'location', type: 'geopoint', facet: false },
];

/**
 * Unindexed Cargo Fields (Stored for UI only - index: false to protect RAM)
 * Heavy text or media arrays needed for rendering UI but NOT for searching.
 */
export interface UnindexedField {
  name: string;
  type: string;
  index?: boolean;
  facet?: boolean;
}

export const unindexedFields: UnindexedField[] = [
  { name: 'public_remarks', type: 'string', index: false, facet: false },
  { name: 'tax_annual', type: 'float', index: false, facet: false },
  { name: 'association_fee', type: 'float', index: false, facet: false },
  { name: 'raw_images', type: 'string[]', index: false, facet: false },
  { name: 'raw_rooms', type: 'auto', index: false, facet: false },
];

/**
 * Complete collection schema for the 'properties' collection.
 * Uses the 'properties' collection name per the task requirements.
 */
export const typesenseSchema = {
  name: 'properties',
  fields: [
    // ─── Indexed Core ───────────────────────────────────────────────────────
    { name: 'id', type: 'string' as const, facet: false },
    { name: 'listing_key', type: 'string' as const, facet: false },
    { name: 'list_price', type: 'int32' as const, facet: true, sort: true },
    { name: 'property_type', type: 'string' as const, facet: true },
    { name: 'property_sub_type', type: 'string' as const, facet: true },
    { name: 'bedrooms', type: 'int32' as const, facet: true, sort: true },
    { name: 'bathrooms', type: 'int32' as const, facet: true, sort: true },
    { name: 'parking', type: 'int32' as const, facet: true, sort: true },
    { name: 'city', type: 'string' as const, facet: true },
    { name: 'city_region', type: 'string' as const, facet: true },
    { name: 'postal_code', type: 'string' as const, facet: true },
    { name: 'basement_type', type: 'string[]' as const, facet: true },
    { name: 'kitchens', type: 'int32' as const, facet: true },
    { name: 'lot_width', type: 'float' as const, facet: true, sort: true },
    { name: 'lot_depth', type: 'float' as const, facet: true, sort: true },
    { name: 'lot_sqft_total', type: 'float' as const, facet: true, sort: true },
    
    // ─── Extrapolated Cap Rate (Phase 3) ───────────────────────────────────────
    { name: 'total_capital_basis', type: 'float' as const, facet: true, sort: true },
    { name: 'extrapolated_cap_rate', type: 'float' as const, facet: true, sort: true },
    { name: 'capital_burn_rate_monthly', type: 'float' as const, facet: true, sort: true },
    
    // ─── Temporal Distress (Phase 4) ───────────────────────────────────────
    { name: 'property_hash', type: 'string' as const, index: false, facet: false },
    { name: 'true_dom', type: 'int32' as const, facet: true, sort: true },
    { name: 'total_price_drop', type: 'int32' as const, sort: true },
    
    { name: 'status', type: 'string' as const, facet: true },
    { name: 'approx_age', type: 'string' as const, facet: true },
    { name: 'entry_timestamp', type: 'int64' as const, sort: true },
    { name: 'location', type: 'geopoint' as const, facet: false },
    
    // ─── Unindexed Cargo ────────────────────────────────────────────────────
    { name: 'public_remarks', type: 'string' as const, index: false, facet: false },
    { name: 'tax_annual', type: 'float' as const, index: false, facet: false },
    { name: 'association_fee', type: 'float' as const, index: false, facet: false },
    { name: 'raw_images', type: 'string[]' as const, index: false, facet: false },
    { name: 'raw_rooms', type: 'auto' as const, index: false, facet: false },
  ],
  
  // Default sort: freshest inventory first (by entry timestamp descending)
  default_sorting_field: 'entry_timestamp',
};

/**
 * TypeScript type for a Typesense document matching this schema.
 */
export interface TypesensePropertyDocument {
  // Indexed Core
  id: string;
  listing_key: string;
  list_price: number;
  property_type: string | null;
  property_sub_type: string | null;
  bedrooms: number;
  bathrooms: number;
  parking: number;
  city: string | null;
  city_region: string | null;
  postal_code: string | null;
  basement_type: string[];
  kitchens: number;
  lot_width: number;
  lot_depth: number;
  lot_sqft_total: number;
  status: string | null;
  approx_age: string | null;
  entry_timestamp: number;
  location: [number, number]; // [lat, lng]
  
  // ─── Extrapolated Cap Rate (Phase 3) ──────────────────────────────────────
  /** Total capital basis (list price + closing + capex + holding costs) */
  total_capital_basis: number;
  /** Extrapolated cap rate as percentage (e.g., 8.25 for 8.25%) */
  extrapolated_cap_rate: number;
  /** Monthly capital burn rate (mortgage + taxes + HOA + insurance) */
  capital_burn_rate_monthly: number;
  
  // ─── Temporal Distress (Phase 4) ──────────────────────────────────────
  /** SHA-256 hash of normalized address for entity resolution (stored, not indexed) */
  property_hash: string;
  /** True Days on Market (Shadow DOM) - cumulative days including relists */
  true_dom: number;
  /** $ delta from first listing in chain to current list price */
  total_price_drop: number;
  
  // ─── ADU/Suite Potential (Phase 2) ──────────────────────────────────────
  // Distress Analysis
  distress_score: number;
  distress_vectors: string[];
  is_financial_distress: boolean;
  is_physical_distress: boolean;
  
  // Eligibility Filter
  is_universally_eligible: boolean;
  universal_rejection_reason: string | null;
  is_internal_eligible: boolean;
  internal_rejection_reason: string | null;
  is_detached_eligible: boolean;
  detached_rejection_reason: string | null;
  
  // Unindexed Cargo
  public_remarks: string | null;
  tax_annual: number;
  association_fee: number;
  raw_images: string[];
  raw_rooms: unknown;
}

/**
 * Get list of indexed field names (for filter construction)
 */
export function getIndexedFieldNames(): string[] {
  return indexedFields.map(f => f.name);
}

/**
 * Get list of sortable field names
 */
export function getSortableFieldNames(): string[] {
  return indexedFields.filter(f => f.sort).map(f => f.name);
}

export default typesenseSchema;