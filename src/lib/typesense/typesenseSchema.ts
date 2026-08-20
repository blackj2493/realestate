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
  // Sale vs lease — low-cardinality ("For Sale"/"For Lease"), so a real facet is
  // cheap RAM (cf. RAM POLICY above). optional: backfilled in-place on existing docs.
  { name: 'TransactionType', type: 'string', facet: true, optional: true },

  // Bedrooms / Bathrooms / Parking — range sliders, not facets
  { name: 'BedroomsTotal', type: 'int32', facet: false, sort: true },
  // Above/below-grade split for the "4+1" card label. optional: backfilled in-place on existing docs.
  { name: 'BedroomsAboveGrade', type: 'int32', facet: false, sort: false, optional: true },
  { name: 'BedroomsBelowGrade', type: 'int32', facet: false, sort: false, optional: true },
  { name: 'BathroomsTotalInteger', type: 'int32', facet: false, sort: true },
  { name: 'ParkingTotal', type: 'int32', facet: false, sort: true },
  // Garage (covered) spaces — size/frontage/price-tier proxy for the comparables matcher.
  // optional: backfilled in-place; absent ≠ 0 (unknown vs no garage).
  { name: 'CoveredSpaces', type: 'int32', facet: false, sort: false, optional: true },

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

  // Interior size as an INTERVAL, not a number. TRREB publishes a band for
  // residential ("1100-1500") and an exact value essentially only for commercial,
  // so filtering on a collapsed midpoint asserts a precision the feed does not
  // have. Indexing both bounds lets the query separate a certain match
  // (band contained in the range) from a possible one (band merely overlaps it).
  // Range fields, so sortable but never faceted — see RAM POLICY above.
  // -1 on both = the listing reports no size at all.
  { name: 'sqft_min', type: 'int32', facet: false, sort: true, optional: true },
  { name: 'sqft_max', type: 'int32', facet: false, sort: true, optional: true },

  // Maintenance/condo fee — range slider (filter + histogram), not a facet.
  { name: 'AssociationFee', type: 'float', facet: false, sort: true, optional: true },

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
  // Rental-native twins of TrueDom/TotalPriceDrop — the LEASE campaign's DOM + rent
  // reduction, for the "For Rent" dashboard boards. 0 for sale listings. Kept
  // SEPARATE from the sale fields so the region RPCs / analytics stay untouched.
  { name: 'LeaseTrueDom', type: 'int32', facet: false, sort: true },
  { name: 'LeaseTotalPriceDrop', type: 'int32', sort: true },
  { name: 'IsSold', type: 'bool', facet: true },

  // ─── Suite Analysis (Phase 5) — status enum is a facet, score is a slider ─
  { name: 'SuiteStatus', type: 'string', facet: true },
  { name: 'SuiteScore', type: 'int32', facet: false, sort: true },

  // ─── Persona 2: Cashflow Investor — all numerics are sliders ──────────────
  { name: 'cap_rate_est', type: 'float', facet: false, sort: true },
  // Which rung of the rent ladder produced cap_rate_est / gross_yield_est.
  // optional: pre-124 documents carry no value until they are re-transformed.
  { name: 'rent_match_tier', type: 'string', facet: false, optional: true },
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
  // Municipal zoning code (e.g. Toronto "RD"). The transformer writes it from the MLS
  // `Zoning` field, but that source is ~empty for residential — so it is stored-but-empty
  // on every doc today (the Builders "Zoning" column shows "—"). To be POPULATED by the
  // zoning-harvest backfill (scripts/admin/zoning-sources.json, Phase 1). Declared here so
  // a future Builders zoning filter works; the live-collection alter runs WITH that backfill
  // (cf. backfill-school-fields.ts), not standalone. Indexed but NOT faceted (RAM policy);
  // optional (sparse/empty until the backfill lands).
  { name: 'zoning_designation', type: 'string', facet: false, optional: true },

  // Standard API Inputs (low-cardinality enums)
  { name: 'OccupantType', type: 'string', facet: true },
  { name: 'PossessionType', type: 'string', facet: true },
  // Compass facing for the Faces filter — DirectionFaces (houses) → Exposure (condos),
  // normalised to 8 points (src/lib/listings/directionFaces.ts). Low-card facet = cheap
  // RAM. optional: backfilled in-place on existing docs (absent until backfill runs).
  { name: 'DirectionFaces', type: 'string', facet: true, optional: true },

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

  // ─── Amenity proximity (nearest grocery + recreation centre) — walkability ──
  // Straight-line km, sortable + filterable (NearestGroceryKm:<=X). NO_AMENITY_KM (99)
  // sentinel when none in range, so `<=X` never false-matches. Names ride as stored
  // cargo (see ListingDocument), not indexed. Source: Overture Maps (CDLA-Permissive).
  { name: 'NearestGroceryKm', type: 'float', facet: false, sort: true, optional: true },
  { name: 'NearestRecCentreKm', type: 'float', facet: false, sort: true, optional: true },
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
  // AssociationFee promoted to an indexed range field (see indexedFields).
  { name: 'RawImages', type: 'string[]', index: false, facet: false },
  // Best-fit thumbnail URL chosen by selectPrimaryImage() — stored, not searchable.
  { name: 'primaryImageUrl', type: 'string', index: false, facet: false, optional: true },
  // Listing brokerage — display cargo for the TRREB §6.3(c) text label on every card.
  { name: 'ListOfficeName', type: 'string', index: false, facet: false, optional: true },
  // Zoning cargo — municipal open data (NOT MLS), display-only. Plain-language name + a
  // provenance key that resolves to source/by-law/attribution (src/lib/zoning/attribution.ts).
  { name: 'zoning_desc', type: 'string', index: false, facet: false, optional: true },
  { name: 'zoning_source', type: 'string', index: false, facet: false, optional: true },
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
    // Sale vs lease — low-cardinality facet (see RAM POLICY); optional for back-compat.
    { name: 'TransactionType', type: 'string' as const, facet: true, optional: true },
    { name: 'BedroomsTotal', type: 'int32' as const, facet: false, sort: true },
    { name: 'BedroomsAboveGrade', type: 'int32' as const, facet: false, sort: false, optional: true },
    { name: 'BedroomsBelowGrade', type: 'int32' as const, facet: false, sort: false, optional: true },
    { name: 'BathroomsTotalInteger', type: 'int32' as const, facet: false, sort: true },
    { name: 'ParkingTotal', type: 'int32' as const, facet: false, sort: true },
    // Garage (covered) spaces — comparables size/frontage proxy; optional (absent ≠ 0).
    { name: 'CoveredSpaces', type: 'int32' as const, facet: false, sort: false, optional: true },
    { name: 'City', type: 'string' as const, facet: true },
    { name: 'CityRegion', type: 'string' as const, facet: true },
    { name: 'UnparsedAddress', type: 'string' as const, facet: false, optional: true },
    { name: 'PostalCode', type: 'string' as const, facet: false },
    { name: 'BasementType', type: 'string[]' as const, facet: true },
    { name: 'KitchensTotal', type: 'int32' as const, facet: false },
    { name: 'LotWidth', type: 'float' as const, facet: false, sort: true },
    { name: 'LotDepth', type: 'float' as const, facet: false, sort: true },
    { name: 'LotSqftTotal', type: 'float' as const, facet: false, sort: true },
    // Interior size as an INTERVAL — see the note in `indexedFields` above.
    // sqft_min/sqft_max carry the band's real bounds (or an exact value collapsed
    // to a one-wide interval), so "definitely ≥ 1,800" and "might be ≥ 1,800" are
    // separable. optional: added 2026-07-30, backfilled in-place on existing docs.
    { name: 'sqft_min', type: 'int32' as const, facet: false, sort: true, optional: true },
    { name: 'sqft_max', type: 'int32' as const, facet: false, sort: true, optional: true },
    // Maintenance/condo fee — indexed (filter + sort + slider histogram). NOT a
    // facet: it's a numeric range, so per-value facet maps would waste RAM (RAM
    // POLICY above). optional: the field predates indexing on existing docs.
    { name: 'AssociationFee', type: 'float' as const, facet: false, sort: true, optional: true },

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
    // Rental-native twins (LEASE campaign DOM + rent reduction); 0 for sale listings.
    { name: 'LeaseTrueDom', type: 'int32' as const, facet: false, sort: true },
    { name: 'LeaseTotalPriceDrop', type: 'int32' as const, sort: true },

    // ─── Persona 2: Cashflow Investor — range sliders ──────────────────────
    { name: 'cap_rate_est', type: 'float' as const, facet: false, sort: true },
    { name: 'rent_match_tier', type: 'string' as const, facet: false, optional: true },
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
    // Municipal zoning code — stored-but-empty today (MLS `Zoning` is ~empty); to be
    // populated by the zoning-harvest backfill (Phase 1). Indexed (not faceted, RAM policy)
    // for a future Builders zoning filter; optional (sparse). Live alter runs WITH the backfill.
    { name: 'zoning_designation', type: 'string' as const, facet: false, optional: true },

    // Standard API Inputs
    { name: 'OccupantType', type: 'string' as const, facet: true },
    { name: 'PossessionType', type: 'string' as const, facet: true },
    // Compass facing (DirectionFaces → Exposure, normalised). Low-card facet; optional
    // (backfilled in-place). See scripts/admin/add-direction-faces.ts.
    { name: 'DirectionFaces', type: 'string' as const, facet: true, optional: true },

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

    // ─── Amenity proximity — walkability distance sliders (NO_AMENITY_KM sentinel) ──
    { name: 'NearestGroceryKm', type: 'float' as const, facet: false, sort: true, optional: true },
    { name: 'NearestRecCentreKm', type: 'float' as const, facet: false, sort: true, optional: true },

    // Investor-filter fields — written by transformer.ts since Phase 2 but undeclared
    // until 2026-06-10 (audit HIGH-5): every filter_by/sort_by on them was HTTP 400.
    // Live collection altered via scripts/admin/add-investor-filter-fields.ts.
    { name: 'isDistressed', type: 'bool' as const, facet: true },
    { name: 'hasSecondarySuitePotential', type: 'bool' as const, facet: true },
    { name: 'calculatedDOM', type: 'int32' as const, facet: false, sort: true, optional: true },
    // BuildingAreaTotal, LivingAreaRange and price_discovery_flag stay stored-only
    // (display cargo). Size FILTERING goes through sqft_min/sqft_max above — the raw
    // band string and the ~residential-empty exact value are for rendering only.

    // ─── Unindexed Cargo ────────────────────────────────────────────────────
    { name: 'PublicRemarks', type: 'string' as const, index: false, facet: false },
    { name: 'TaxAnnualAmount', type: 'float' as const, index: false, facet: false },
    // AssociationFee is now an indexed range field (see above).
    { name: 'RawImages', type: 'string[]' as const, index: false, facet: false },
    // Best-fit thumbnail URL chosen by selectPrimaryImage() — stored, not searchable.
    { name: 'primaryImageUrl', type: 'string' as const, index: false, facet: false, optional: true },
    // Listing brokerage — display cargo for the TRREB §6.3(c) text label on every card.
    { name: 'ListOfficeName', type: 'string' as const, index: false, facet: false, optional: true },
    // Zoning cargo — municipal open data (NOT MLS), display-only (plain-language + provenance key).
    { name: 'zoning_desc', type: 'string' as const, index: false, facet: false, optional: true },
    { name: 'zoning_source', type: 'string' as const, index: false, facet: false, optional: true },
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
  BedroomsAboveGrade?: number;
  BedroomsBelowGrade?: number;
  BathroomsTotalInteger: number;
  ParkingTotal: number;
  /** Garage (covered) parking spaces; omitted when unknown (≠ 0 = no garage). */
  CoveredSpaces?: number;
  
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

  /** Interior size bounds, half-open [sqft_min, sqft_max). Both -1 when the
   *  listing reports no size. See @/lib/listings/livingAreaBands. */
  sqft_min?: number;
  sqft_max?: number;

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
  /** Rung that produced the rent behind cap_rate_est. See src/lib/metrics/rentTier.ts. */
  rent_match_tier?: string;
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
  /** Normalised compass facing (DirectionFaces for houses, Exposure for condos);
   *  one of the 8 points or "" when unknown. Omitted on docs predating the backfill. */
  DirectionFaces?: string;
  
  // ─── Temporal Distress (Phase 4) ──────────────────────────────────────
  /** SHA-256 hash of normalized address for entity resolution (stored, not indexed) */
  PropertyHash: string;
  /** True Days on Market (Shadow DOM) - cumulative days including relists */
  TrueDom: number;
  /** $ delta from first listing in chain to current list price */
  TotalPriceDrop: number;
  /** True if TrueDom > 60 days - stale inventory indicator (STALE_THRESHOLD_DAYS) */
  IsStale: boolean;
  /** LEASE-track True DOM — rental days-on-market (0 for sale listings). */
  LeaseTrueDom: number;
  /** LEASE-track rent reduction $ (0 for sale listings). */
  LeaseTotalPriceDrop: number;
  
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

  // ─── Amenity proximity (Overture Maps) ────────────────────────────────────
  /** Straight-line km to the nearest grocery / recreation centre; NO_AMENITY_KM (99)
   *  when none within range. Km is indexed (walkability filter); names are display cargo. */
  NearestGroceryKm?: number;
  NearestGroceryName?: string;
  NearestRecCentreKm?: number;
  NearestRecCentreName?: string;
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