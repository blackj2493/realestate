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
  optional?: boolean;
}

// RAM POLICY (2026-05-19 — Typesense memory pressure cleanup):
// Numeric fields used as range filters (>=, <=, [min..max]) do NOT need `facet: true`.
// Facets materialize per-value bucket maps in RAM — they only earn their keep for
// low-cardinality categorical UI (dropdowns, multi-selects). Every numeric below is a
// slider/range in the UI, so they are kept sortable but no longer faceted.
// PostalCode demoted: ~tens of thousands of unique values = pure RAM waste.
export const indexedFields: IndexedField[] = [
  // Identity
  { name: 'id', type: 'string', facet: false },

  // Price — range slider, not a facet
  { name: 'ListPrice', type: 'int32', facet: false, sort: true },

  // Property Classification — categorical, real facets
  { name: 'PropertyType', type: 'string', facet: true },
  { name: 'PropertySubType', type: 'string', facet: true },

  // Bedrooms / Bathrooms / Parking — range sliders, not facets
  { name: 'BedroomsTotal', type: 'int32', facet: false, sort: true },
  { name: 'BathroomsTotalInteger', type: 'int32', facet: false, sort: true },
  { name: 'ParkingTotal', type: 'int32', facet: false, sort: true },

  // Location — city/region dropdowns are real facets; PostalCode is too high-cardinality.
  // UnparsedAddress: indexed (not faceted) so the search bar can typeahead street
  // addresses. Default prefix matching covers "99 vic" → "99 Victoria…"; no infix
  // (RAM policy). High-cardinality, so never facet it.
  { name: 'City', type: 'string', facet: true },
  { name: 'CityRegion', type: 'string', facet: true },
  { name: 'UnparsedAddress', type: 'string', facet: false, optional: true },
  { name: 'PostalCode', type: 'string', facet: false },

  // Basement (multi-select) — real facet. KitchensTotal is a range, not a facet
  { name: 'BasementType', type: 'string[]', facet: true },
  { name: 'KitchensTotal', type: 'int32', facet: false },

  // Lot Dimensions — range sliders, not facets
  { name: 'LotWidth', type: 'float', facet: false, sort: true },
  { name: 'LotDepth', type: 'float', facet: false, sort: true },
  { name: 'LotSqftTotal', type: 'float', facet: false, sort: true },

  // ─── Extrapolated Cap Rate (Phase 3) — range sliders ──────────────────────
  { name: 'TotalCapitalBasis', type: 'float', facet: false, sort: true },
  { name: 'ExtrapolatedCapRate', type: 'float', facet: false, sort: true },
  { name: 'CapitalBurnRateMonthly', type: 'float', facet: false, sort: true },

  // ─── True Carry Cost (Phase 5) — range sliders ────────────────────────────
  { name: 'MonthlyCarryCost', type: 'float', facet: false, sort: true },
  { name: 'MonthlyMortgage', type: 'float', facet: false, sort: true },
  { name: 'MonthlyPropertyTax', type: 'float', facet: false, sort: true },
  { name: 'MonthlyHOA', type: 'float', facet: false, sort: true },
  { name: 'MonthlyInsurance', type: 'float', facet: false, sort: true },
  { name: 'MonthlyCapEx', type: 'float', facet: false, sort: true },

  // ─── Temporal Distress (Phase 4) — TrueDom is a slider, booleans are facets ─
  { name: 'TrueDom', type: 'int32', facet: false, sort: true },
  { name: 'TotalPriceDrop', type: 'int32', sort: true },
  { name: 'IsStale', type: 'bool', facet: true },
  { name: 'IsSold', type: 'bool', facet: true },

  // ─── Suite Analysis (Phase 5) — status enum is a facet, score is a slider ─
  { name: 'SuiteStatus', type: 'string', facet: true },
  { name: 'SuiteScore', type: 'int32', facet: false, sort: true },

  // ─── Persona 2: Cashflow Investor — all numerics are sliders ──────────────
  { name: 'cap_rate_est', type: 'float', facet: false, sort: true },
  { name: 'cap_rate_floor', type: 'float', facet: false, sort: true },
  { name: 'gross_yield_est', type: 'float', facet: false, sort: true },
  { name: 'net_monthly_cashflow', type: 'int32', facet: false, sort: true },
  { name: 'cashflow_floor', type: 'int32', facet: false },
  { name: 'tax_burden_ratio', type: 'float', facet: false },
  { name: 'assessment_status', type: 'string', facet: true },

  // Multi-Unit / Suite Scoring
  { name: 'multi_unit_status', type: 'string', facet: true },
  { name: 'suite_confidence', type: 'string' },

  // Parking / Density
  { name: 'surplus_parking_count', type: 'int32', facet: false, sort: true },
  { name: 'is_density_ready', type: 'bool', facet: true },

  // Standard API Inputs (low-cardinality enums)
  { name: 'OccupantType', type: 'string', facet: true },
  { name: 'PossessionType', type: 'string', facet: true },

  // Status & Age
  { name: 'Status', type: 'string', facet: true },
  { name: 'ApproximateAge', type: 'string', facet: true },

  // Timestamp for fast sorting by entry date
  { name: 'EntryTimestamp', type: 'int64', sort: true },

  // Geolocation (for map viewport queries)
  { name: 'location', type: 'geopoint', facet: false },

  // ─── School-Aware Search (nearest rated school per panel) — score sliders ──
  // One indexed sortable field per Level×System lens + "either-system" rollups.
  // optional: existing docs predate these; backfilled in-place (no reindex).
  { name: 'ElemPublicScore', type: 'float', facet: false, sort: true, optional: true },
  { name: 'ElemCatholicScore', type: 'float', facet: false, sort: true, optional: true },
  { name: 'SecPublicScore', type: 'float', facet: false, sort: true, optional: true },
  { name: 'SecCatholicScore', type: 'float', facet: false, sort: true, optional: true },
  { name: 'BestElementaryScore', type: 'float', facet: false, sort: true, optional: true },
  { name: 'BestSecondaryScore', type: 'float', facet: false, sort: true, optional: true },
  { name: 'BestSchoolScoreNearby', type: 'float', facet: false, sort: true, optional: true },
  // Target-school filter: ids of nearby schools, filterable via NearbySchools:=<id>.
  { name: 'NearbySchools', type: 'string[]', facet: false, optional: true },
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
  optional?: boolean;
}

export const unindexedFields: UnindexedField[] = [
  { name: 'PublicRemarks', type: 'string', index: false, facet: false },
  { name: 'TaxAnnualAmount', type: 'float', index: false, facet: false },
  { name: 'AssociationFee', type: 'float', index: false, facet: false },
  { name: 'RawImages', type: 'string[]', index: false, facet: false },
  { name: 'RawRooms', type: 'auto', index: false, facet: false },
  { name: 'PropertyHash', type: 'string', index: false, facet: false },
  // School cargo (display only): per-panel nearest-school name + distance in km.
  { name: 'ElemPublicSchool', type: 'string', index: false, facet: false, optional: true },
  { name: 'ElemPublicDistanceKm', type: 'float', index: false, facet: false, optional: true },
  { name: 'ElemCatholicSchool', type: 'string', index: false, facet: false, optional: true },
  { name: 'ElemCatholicDistanceKm', type: 'float', index: false, facet: false, optional: true },
  { name: 'SecPublicSchool', type: 'string', index: false, facet: false, optional: true },
  { name: 'SecPublicDistanceKm', type: 'float', index: false, facet: false, optional: true },
  { name: 'SecCatholicSchool', type: 'string', index: false, facet: false, optional: true },
  { name: 'SecCatholicDistanceKm', type: 'float', index: false, facet: false, optional: true },
];

/**
 * Complete collection schema for the 'properties' collection.
 * Uses the 'properties' collection name per the task requirements.
 */
export const typesenseSchema = {
  name: 'properties',
  fields: [
    // ─── Indexed Core (see RAM POLICY note above) ───────────────────────────
    { name: 'id', type: 'string' as const, facet: false },
    { name: 'ListPrice', type: 'int32' as const, facet: false, sort: true },
    { name: 'PropertyType', type: 'string' as const, facet: true },
    { name: 'PropertySubType', type: 'string' as const, facet: true },
    { name: 'BedroomsTotal', type: 'int32' as const, facet: false, sort: true },
    { name: 'BathroomsTotalInteger', type: 'int32' as const, facet: false, sort: true },
    { name: 'ParkingTotal', type: 'int32' as const, facet: false, sort: true },
    { name: 'City', type: 'string' as const, facet: true },
    { name: 'CityRegion', type: 'string' as const, facet: true },
    { name: 'UnparsedAddress', type: 'string' as const, facet: false, optional: true },
    { name: 'PostalCode', type: 'string' as const, facet: false },
    { name: 'BasementType', type: 'string[]' as const, facet: true },
    { name: 'KitchensTotal', type: 'int32' as const, facet: false },
    { name: 'LotWidth', type: 'float' as const, facet: false, sort: true },
    { name: 'LotDepth', type: 'float' as const, facet: false, sort: true },
    { name: 'LotSqftTotal', type: 'float' as const, facet: false, sort: true },

    // ─── Extrapolated Cap Rate (Phase 3) — range sliders ───────────────────
    { name: 'TotalCapitalBasis', type: 'float' as const, facet: false, sort: true },
    { name: 'ExtrapolatedCapRate', type: 'float' as const, facet: false, sort: true },
    { name: 'CapitalBurnRateMonthly', type: 'float' as const, facet: false, sort: true },

    // ─── True Carry Cost (Phase 5) — range sliders ─────────────────────────
    { name: 'MonthlyCarryCost', type: 'float' as const, facet: false, sort: true },
    { name: 'MonthlyMortgage', type: 'float' as const, facet: false, sort: true },
    { name: 'MonthlyPropertyTax', type: 'float' as const, facet: false, sort: true },
    { name: 'MonthlyHOA', type: 'float' as const, facet: false, sort: true },
    { name: 'MonthlyInsurance', type: 'float' as const, facet: false, sort: true },
    { name: 'MonthlyCapEx', type: 'float' as const, facet: false, sort: true },

    // ─── Suite Analysis (Phase 5) ──────────────────────────────────────────
    { name: 'SuiteStatus', type: 'string' as const, facet: true },
    { name: 'SuiteScore', type: 'int32' as const, facet: false, sort: true },

    // ─── Temporal Distress (Phase 4) ───────────────────────────────────────
    { name: 'PropertyHash', type: 'string' as const, index: false, facet: false },
    { name: 'TrueDom', type: 'int32' as const, facet: false, sort: true },
    { name: 'TotalPriceDrop', type: 'int32' as const, sort: true },
    { name: 'IsStale', type: 'bool' as const, facet: true },

    // ─── Persona 2: Cashflow Investor — range sliders ──────────────────────
    { name: 'cap_rate_est', type: 'float' as const, facet: false, sort: true },
    { name: 'cap_rate_floor', type: 'float' as const, facet: false, sort: true },
    { name: 'gross_yield_est', type: 'float' as const, facet: false, sort: true },
    { name: 'net_monthly_cashflow', type: 'int32' as const, facet: false, sort: true },
    { name: 'cashflow_floor', type: 'int32' as const, facet: false },
    { name: 'tax_burden_ratio', type: 'float' as const, facet: false },
    { name: 'assessment_status', type: 'string' as const, facet: true },

    // Multi-Unit / Suite Scoring
    { name: 'multi_unit_status', type: 'string' as const, facet: true },
    { name: 'suite_confidence', type: 'string' as const },

    // Parking / Density
    { name: 'surplus_parking_count', type: 'int32' as const, facet: false, sort: true },
    { name: 'is_density_ready', type: 'bool' as const, facet: true },

    // Standard API Inputs
    { name: 'OccupantType', type: 'string' as const, facet: true },
    { name: 'PossessionType', type: 'string' as const, facet: true },

    { name: 'Status', type: 'string' as const, facet: true },
    { name: 'ApproximateAge', type: 'string' as const, facet: true },
    { name: 'EntryTimestamp', type: 'int64' as const, sort: true },
    { name: 'location', type: 'geopoint' as const, facet: false },

    // ─── School-Aware Search — indexed score sliders + target filter ─────────
    { name: 'ElemPublicScore', type: 'float' as const, facet: false, sort: true, optional: true },
    { name: 'ElemCatholicScore', type: 'float' as const, facet: false, sort: true, optional: true },
    { name: 'SecPublicScore', type: 'float' as const, facet: false, sort: true, optional: true },
    { name: 'SecCatholicScore', type: 'float' as const, facet: false, sort: true, optional: true },
    { name: 'BestElementaryScore', type: 'float' as const, facet: false, sort: true, optional: true },
    { name: 'BestSecondaryScore', type: 'float' as const, facet: false, sort: true, optional: true },
    { name: 'BestSchoolScoreNearby', type: 'float' as const, facet: false, sort: true, optional: true },
    { name: 'NearbySchools', type: 'string[]' as const, facet: false, optional: true },

    // ─── Unindexed Cargo ────────────────────────────────────────────────────
    { name: 'PublicRemarks', type: 'string' as const, index: false, facet: false },
    { name: 'TaxAnnualAmount', type: 'float' as const, index: false, facet: false },
    { name: 'AssociationFee', type: 'float' as const, index: false, facet: false },
    { name: 'RawImages', type: 'string[]' as const, index: false, facet: false },
    { name: 'RawRooms', type: 'auto' as const, index: false, facet: false },
    // School cargo (display only): per-panel nearest-school name + distance.
    { name: 'ElemPublicSchool', type: 'string' as const, index: false, facet: false, optional: true },
    { name: 'ElemPublicDistanceKm', type: 'float' as const, index: false, facet: false, optional: true },
    { name: 'ElemCatholicSchool', type: 'string' as const, index: false, facet: false, optional: true },
    { name: 'ElemCatholicDistanceKm', type: 'float' as const, index: false, facet: false, optional: true },
    { name: 'SecPublicSchool', type: 'string' as const, index: false, facet: false, optional: true },
    { name: 'SecPublicDistanceKm', type: 'float' as const, index: false, facet: false, optional: true },
    { name: 'SecCatholicSchool', type: 'string' as const, index: false, facet: false, optional: true },
    { name: 'SecCatholicDistanceKm', type: 'float' as const, index: false, facet: false, optional: true },
  ],
  
  // Default sort: freshest inventory first (by entry timestamp descending)
  default_sorting_field: 'EntryTimestamp',
};

/**
 * TypeScript type for a Typesense document matching this schema.
 */
export interface TypesensePropertyDocument {
  // Identity
  id: string;
  
  // Price
  ListPrice: number;
  
  // Property Classification
  PropertyType: string | null;
  PropertySubType: string | null;
  
  // Bedrooms / Bathrooms / Parking
  BedroomsTotal: number;
  BathroomsTotalInteger: number;
  ParkingTotal: number;
  
  // Location
  City: string | null;
  CityRegion: string | null;
  PostalCode: string | null;
  
  // Basement & Kitchens
  BasementType: string[];
  KitchensTotal: number;
  
  // Lot Dimensions
  LotWidth: number;
  LotDepth: number;
  LotSqftTotal: number;
  
  // Status & Age
  Status: string | null;
  ApproximateAge: string | null;
  
  // Timestamp for fast sorting by entry date
  EntryTimestamp: number;
  
  // Geolocation (for map viewport queries)
  location: [number, number]; // [lat, lng]
  
  // ─── Extrapolated Cap Rate (Phase 3) ──────────────────────────────────────
  /** Total capital basis (list price + closing + capex + holding costs) */
  TotalCapitalBasis: number;
  /** Extrapolated cap rate as percentage (e.g., 8.25 for 8.25%) */
  ExtrapolatedCapRate: number;
  /** Monthly capital burn rate (mortgage + taxes + HOA + insurance) */
  CapitalBurnRateMonthly: number;
  
  // ─── True Carry Cost (Phase 5) ─────────────────────────────────────────
  /** Total monthly carry cost (mortgage + tax + HOA + insurance + capex) */
  MonthlyCarryCost: number;
  /** Monthly mortgage payment (Canadian semi-annual compounding) */
  MonthlyMortgage: number;
  /** Monthly property tax (actual or mill rate estimate) */
  MonthlyPropertyTax: number;
  /** Monthly HOA/condo fee (0 for freehold) */
  MonthlyHOA: number;
  /** Monthly insurance ($40 condo, $135 freehold, $200 multi-family) */
  MonthlyInsurance: number;
  /** Monthly CapEx reserve (1% rule) */
  MonthlyCapEx: number;
  
  // ─── Suite Analysis (Phase 5) ─────────────────────────────────────────
  /** Secondary suite status: NONE, POTENTIAL_CANDIDATE, EXISTING_SUITE */
  SuiteStatus: 'NONE' | 'POTENTIAL_CANDIDATE' | 'EXISTING_SUITE';
  /** Suite potential score (0-6 points) */
  SuiteScore: number;
  
  // ─── Persona 2: Cashflow Investor Terminal ──────────────────────────────
  // Derived Financial Metrics
  /** Estimated cap rate using market rent (e.g., 4.63 for 4.63%) */
  cap_rate_est: number;
  /** Cap rate floor using P10 rent + 8% vacancy (conservative scenario) */
  cap_rate_floor: number;
  /** Estimated gross yield: Annual Rent / ListPrice */
  gross_yield_est: number;
  /** Net monthly cashflow after mortgage, taxes, insurance, HOA, capex */
  net_monthly_cashflow: number;
  /** Conservative monthly cashflow using P10 rent + 8% vacancy + 1.5% maintenance */
  cashflow_floor: number;
  /** Tax burden ratio: (TaxAnnualAmount / TrueValue) × 100 */
  tax_burden_ratio: number;
  /** Assessment status: OVER_ASSESSED | UNDER_ASSESSED_RISK | MARKET_AVERAGE | UNASSESSED */
  assessment_status: 'OVER_ASSESSED' | 'UNDER_ASSESSED_RISK' | 'MARKET_AVERAGE' | 'UNASSESSED' | '';
  
  // Multi-Unit / Suite Scoring
  /** Multi-unit status: NOT_VIABLE | EXISTING_MULTI_UNIT | PRIME_CANDIDATE | MARGINAL_CANDIDATE */
  multi_unit_status: 'NOT_VIABLE' | 'EXISTING_MULTI_UNIT' | 'PRIME_CANDIDATE' | 'MARGINAL_CANDIDATE' | '';
  /** Suite confidence: INHERITED_TENANT_RISK | TARGET_YIELD | null */
  suite_confidence: 'INHERITED_TENANT_RISK' | 'TARGET_YIELD' | null;
  
  // Parking / Density
  /** Surplus parking count: MAX(0, ParkingTotal - 2) */
  surplus_parking_count: number;
  /** True if surplus_parking_count >= 2 AND PropertySubType = Detached */
  is_density_ready: boolean;
  
  // Standard API Inputs
  /** Occupant type: Tenanted | Vacant possession | null */
  OccupantType: string | null;
  /** Possession type: null | null */
  PossessionType: string | null;
  
  // ─── Temporal Distress (Phase 4) ──────────────────────────────────────
  /** SHA-256 hash of normalized address for entity resolution (stored, not indexed) */
  PropertyHash: string;
  /** True Days on Market (Shadow DOM) - cumulative days including relists */
  TrueDom: number;
  /** $ delta from first listing in chain to current list price */
  TotalPriceDrop: number;
  /** True if TrueDom > 90 days - stale inventory indicator */
  IsStale: boolean;
  
  // ─── ADU/Suite Potential (Phase 2) ──────────────────────────────────────
  // Distress Analysis
  DistressScore: number;
  DistressVectors: string[];
  IsFinancialDistress: boolean;
  IsPhysicalDistress: boolean;
  
  // Eligibility Filter
  IsUniversallyEligible: boolean;
  UniversalRejectionReason: string | null;
  IsInternalEligible: boolean;
  InternalRejectionReason: string | null;
  IsDetachedEligible: boolean;
  DetachedRejectionReason: string | null;
  
  // Unindexed Cargo
  PublicRemarks: string | null;
  TaxAnnualAmount: number;
  AssociationFee: number;
  RawImages: string[];
  RawRooms: unknown;

  // ─── School-Aware Search ──────────────────────────────────────────────────
  /** Nearest rated school score (0–10) per Level×System panel. */
  ElemPublicScore?: number;
  ElemCatholicScore?: number;
  SecPublicScore?: number;
  SecCatholicScore?: number;
  /** "Either-system" rollups for the Level lens + default ranking. */
  BestElementaryScore?: number;
  BestSecondaryScore?: number;
  BestSchoolScoreNearby?: number;
  /** Ids of schools within ~2.5 km, filterable via NearbySchools:=<id>. */
  NearbySchools?: string[];
  /** Per-panel nearest-school name + distance (km) — display cargo. */
  ElemPublicSchool?: string;
  ElemPublicDistanceKm?: number;
  ElemCatholicSchool?: string;
  ElemCatholicDistanceKm?: number;
  SecPublicSchool?: string;
  SecPublicDistanceKm?: number;
  SecCatholicSchool?: string;
  SecCatholicDistanceKm?: number;
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