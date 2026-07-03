/**
 * Property Data Sheet field registry — deterministic payload→rows mapping.
 *
 * Compliance (IDX §6.3(f), CLAUDE.md §4): values are rendered VERBATIM — the only
 * "formatting" permitted is trimming, currency/locale number display, unit
 * suffixes from companion fields, and joining array fields with " · ".
 * No sold-outcome VOW fields and no broker-workflow fields may ever be added
 * here (they are policy-excluded; see datasheet.test.ts policy suite).
 *
 * Pure logic — no React, no Node APIs — so it is unit-testable in vitest's
 * node environment and callable from the server page.
 */

import { formatPrice } from "@/lib/utils";
import { isCommercialProperty } from "@/lib/filters/fundamentals";

export type RawPayload = Record<string, unknown>;

export type DatasheetGroupId =
  | "vitals"
  | "commercial"
  | "commercialFinancials"
  | "building"
  | "interior"
  | "exterior"
  | "condo"
  | "lease"
  | "utilities"
  | "taxes"
  | "transaction"
  | "risk";

export interface ResolvedRow {
  /**
   * Registry identity — unique per field, safe as a React key. NOT necessarily
   * the payload key that produced the value: composite formatters read multiple
   * payload fields (e.g. key "FireplaceYN" may render FireplaceFeatures;
   * "WaterSource" may render Water). Do not use it for payload back-references.
   */
  key: string;
  label: string;
  value: string;
  /** External link rows (virtual tours). */
  href?: string;
  /** Amber risk accent (risk group rows with a concerning value). */
  flagged?: boolean;
}

export interface DatasheetGroupMeta {
  id: DatasheetGroupId;
  title: string;
}

export interface ResolvedGroup {
  group: DatasheetGroupMeta;
  rows: ResolvedRow[];
}

interface DatasheetField {
  key: string;
  label: string;
  group: DatasheetGroupId;
  format: (p: RawPayload) => string | null;
  href?: (p: RawPayload) => string | null;
  flag?: (p: RawPayload) => boolean;
}

// ── null-safe readers (CLAUDE.md §6: expect nulls, wrong types, empty arrays) ──

/** Non-empty trimmed string, else null. Numbers pass through as strings. */
function str(p: RawPayload, key: string): string | null {
  const v = p[key];
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Finite number, else null. */
function num(p: RawPayload, key: string): number | null {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Array field → primitive members as trimmed strings; scalars wrap; else []. */
function list(p: RawPayload, key: string): string[] {
  const v = p[key];
  const arr = Array.isArray(v) ? v : v != null ? [v] : [];
  return arr
    .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);
}

/** Joined array row value ("A · B"), null when empty. */
function joined(p: RawPayload, key: string): string | null {
  const items = list(p, key);
  return items.length > 0 ? items.join(" · ") : null;
}

/** Boolean flag → "Yes" only when strictly true (a "No" row is noise). */
function yes(p: RawPayload, key: string): string | null {
  return p[key] === true ? "Yes" : null;
}

/** Currency display, null unless a positive finite number. */
function money(p: RawPayload, key: string): string | null {
  const v = num(p, key);
  return v !== null && v > 0 ? formatPrice(v) : null;
}

/** Only http(s) URLs are linkable; anything else is dropped (defence vs feed garbage). */
function safeUrl(p: RawPayload, key: string): string | null {
  const v = str(p, key);
  return v && /^https?:\/\/\S+/i.test(v) ? v : null;
}

/** True when a risk value is "concerning": present and not a benign None/No/Unknown. */
function concerning(values: string[]): boolean {
  const benign = /^(no|none|unknown|n\/a)$/i;
  return values.some((v) => !benign.test(v));
}

/**
 * Drop "Unknown" members: unlike "None" (affirmative absence — informative),
 * "Unknown" asserts nothing and only lights up the risk group as noise.
 */
function withoutUnknown(values: string[]): string[] {
  return values.filter((v) => !/^unknown$/i.test(v));
}

/** Positive finite number rendered as a string, else null. */
function posNum(p: RawPayload, key: string): string | null {
  const v = num(p, key);
  return v !== null && v > 0 ? String(v) : null;
}

// ── group metadata (registry order = default display order) ──

const GROUPS: DatasheetGroupMeta[] = [
  { id: "vitals", title: "Vitals" },
  // Commercial-class groups sit right under Vitals — for a warehouse or restaurant
  // these ARE the headline facts (commercial-gap Phase 1).
  { id: "commercial", title: "Commercial" },
  { id: "commercialFinancials", title: "Commercial Financials" },
  { id: "building", title: "Building & Construction" },
  { id: "interior", title: "Interior" },
  { id: "exterior", title: "Exterior, Lot & Land" },
  { id: "condo", title: "Condo & Building" },
  { id: "lease", title: "Lease Terms" },
  { id: "utilities", title: "Utilities & Systems" },
  { id: "taxes", title: "Taxes & Assessment" },
  { id: "transaction", title: "Transaction & Possession" },
  { id: "risk", title: "Risk & Disclosures" },
];

/** Condo group applies only to condo-class subtypes (objective criteria, §6.3(f)). */
function isCondoClass(p: RawPayload): boolean {
  const sub = (str(p, "PropertySubType") ?? "").toLowerCase();
  return sub.includes("condo") || sub.includes("co-op") || sub.includes("co-ownership");
}

/** Lease group applies only to lease transactions (objective criteria, §6.3(f)). */
function isLeaseTransaction(p: RawPayload): boolean {
  return (str(p, "TransactionType") ?? "").toLowerCase().includes("lease");
}

/** Commercial groups apply only to the Commercial PropertyType class (same rule the
 *  terminal filters by — fundamentals.ts buildClassClause). */
function isCommercialClass(p: RawPayload): boolean {
  return isCommercialProperty(str(p, "PropertyType"));
}

const GROUP_APPLIES: Partial<Record<DatasheetGroupId, (p: RawPayload) => boolean>> = {
  condo: isCondoClass,
  lease: isLeaseTransaction,
  commercial: isCommercialClass,
  commercialFinancials: isCommercialClass,
};

/** Area with its companion unit-code field: "3,500 Square Feet", "100%", "405 Sq Ft".
 *  TRREB quotes commercial area splits either as sqft OR as a percent of the building
 *  (unit code "%") — render the code verbatim, never guess a unit. */
function areaWithUnit(p: RawPayload, areaKey: string, unitKey: string): string | null {
  const v = num(p, areaKey);
  if (v === null || v <= 0) return null;
  const unit = str(p, unitKey);
  const body = v.toLocaleString("en-CA");
  if (!unit) return body;
  return unit === "%" ? `${body}%` : `${body} ${unit}`;
}

// ── field registry ──

const FIELDS: DatasheetField[] = [
  // ── Vitals (absorbs the old Structural Vitals + Property Summary sections) ──
  {
    key: "PropertySubType",
    label: "Property Type",
    group: "vitals",
    format: (p) => str(p, "PropertySubType") ?? str(p, "PropertyType"),
  },
  { key: "ArchitecturalStyle", label: "Style", group: "vitals", format: (p) => joined(p, "ArchitecturalStyle") },
  { key: "ApproximateAge", label: "Property Age", group: "vitals", format: (p) => str(p, "ApproximateAge") },
  {
    key: "LotWidth",
    label: "Lot Dimensions",
    group: "vitals",
    format: (p) => {
      const w = num(p, "LotWidth");
      if (w === null || w <= 0) return null;
      const d = num(p, "LotDepth");
      const units = str(p, "LotSizeUnits");
      return [`${w} x ${d ?? "N/A"}`, units].filter(Boolean).join(" ");
    },
  },
  { key: "DirectionFaces", label: "Direction Faces", group: "vitals", format: (p) => str(p, "DirectionFaces") },
  {
    key: "HeatType",
    label: "Heating",
    group: "vitals",
    format: (p) => [str(p, "HeatType"), str(p, "HeatSource")].filter(Boolean).join(" · ") || null,
  },
  { key: "Cooling", label: "Cooling", group: "vitals", format: (p) => joined(p, "Cooling") },
  { key: "Basement", label: "Basement", group: "vitals", format: (p) => joined(p, "Basement") },
  {
    key: "KitchensTotal",
    label: "Kitchens",
    group: "vitals",
    // Known segments only — never fabricate a 0 the feed did not assert.
    format: (p) => {
      const total = num(p, "KitchensTotal");
      const above = num(p, "KitchensAboveGrade");
      const below = num(p, "KitchensBelowGrade");
      const known = [total, above, below].filter((v): v is number => v !== null);
      if (known.length === 0) return null;
      if (known.every((v) => v === 0)) return null; // all-zero row is noise
      const segs: string[] = [];
      if (above !== null) segs.push(`${above} above`);
      if (below !== null) segs.push(`${below} below`);
      if (total === null) return segs.join(" · ");
      return segs.length > 0 ? `${total} (${segs.join(" · ")})` : String(total);
    },
  },
  {
    key: "RoomsAboveGrade",
    label: "Rooms",
    group: "vitals",
    // Known segments only — never fabricate a 0 the feed did not assert.
    format: (p) => {
      const above = num(p, "RoomsAboveGrade");
      const below = num(p, "RoomsBelowGrade");
      const segs: string[] = [];
      if (above !== null) segs.push(`${above} above`);
      if (below !== null) segs.push(`${below} below`);
      return segs.length > 0 ? segs.join(" · ") : null;
    },
  },
  {
    key: "BedroomsAboveGrade",
    label: "Bedrooms",
    group: "vitals",
    // Known segments only. BedroomsTotal includes below-grade, so the plain-total
    // fallback gets NO "above" suffix and no below segment appended to it.
    format: (p) => {
      const above = num(p, "BedroomsAboveGrade");
      const below = num(p, "BedroomsBelowGrade");
      if (above !== null) {
        const segs = [`${above} above`];
        if (below !== null) segs.push(`${below} below`);
        return segs.join(" · ");
      }
      const total = num(p, "BedroomsTotal");
      if (total !== null) return String(total);
      return below !== null ? `${below} below` : null;
    },
  },
  {
    key: "WashroomsType1",
    label: "Washrooms",
    group: "vitals",
    // Per-level breakdown from the WashroomsType1-5 slots: "2 × 4-pc (Second) · 1 × 2-pc (Main)".
    format: (p) => {
      const parts: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const count = num(p, `WashroomsType${i}`);
        if (count === null || count <= 0) continue;
        const pcs = num(p, `WashroomsType${i}Pcs`);
        const level = str(p, `WashroomsType${i}Level`);
        let part = pcs !== null && pcs > 0 ? `${count} × ${pcs}-pc` : String(count);
        if (level) part += ` (${level})`;
        parts.push(part);
      }
      return parts.length > 0 ? parts.join(" · ") : null;
    },
  },
  { key: "CrossStreet", label: "Cross Street", group: "vitals", format: (p) => str(p, "CrossStreet") },

  // ── Commercial (group gated by isCommercialClass; commercial-gap Phase 1) ──
  // Field spellings verified against live PROPTX payloads (Industrial / Sale Of
  // Business / Store W Apt/Office archetypes, 2026-07-03). Rows self-omit when the
  // feed leaves them empty, so the uncommon ones cost nothing on thin listings.
  { key: "PropertyUse", label: "Property Use", group: "commercial", format: (p) => str(p, "PropertyUse") },
  { key: "BusinessType", label: "Business Type", group: "commercial", format: (p) => joined(p, "BusinessType") },
  { key: "BusinessName", label: "Business Name", group: "commercial", format: (p) => str(p, "BusinessName") },
  { key: "FreestandingYN", label: "Freestanding", group: "commercial", format: (p) => yes(p, "FreestandingYN") },
  {
    key: "BuildingAreaTotal",
    label: "Total Area",
    group: "commercial",
    format: (p) => areaWithUnit(p, "BuildingAreaTotal", "BuildingAreaUnits"),
  },
  {
    key: "OfficeApartmentArea",
    label: "Office / Apt Area",
    group: "commercial",
    format: (p) => areaWithUnit(p, "OfficeApartmentArea", "OfficeApartmentAreaUnit"),
  },
  {
    key: "RetailArea",
    label: "Retail Area",
    group: "commercial",
    format: (p) => areaWithUnit(p, "RetailArea", "RetailAreaCode"),
  },
  {
    key: "IndustrialArea",
    label: "Industrial Area",
    group: "commercial",
    format: (p) => areaWithUnit(p, "IndustrialArea", "IndustrialAreaCode"),
  },
  {
    key: "ClearHeightFeet",
    label: "Clear Height",
    group: "commercial",
    format: (p) => {
      const ft = num(p, "ClearHeightFeet");
      if (ft === null || ft <= 0) return null;
      const inches = num(p, "ClearHeightInches");
      return inches && inches > 0 ? `${ft} ft ${inches} in` : `${ft} ft`;
    },
  },
  {
    key: "GradeLevelShippingDoors",
    label: "Shipping Doors",
    group: "commercial",
    // Composite over the four door-type counts; only >0 segments (all-zero is noise).
    format: (p) => {
      const segs: string[] = [];
      const push = (key: string, label: string) => {
        const v = num(p, key);
        if (v !== null && v > 0) segs.push(`${v} ${label}`);
      };
      push("GradeLevelShippingDoors", "grade-level");
      push("TruckLevelShippingDoors", "truck-level");
      push("DriveInLevelShippingDoors", "drive-in");
      push("DoubleManShippingDoors", "double-man");
      return segs.length > 0 ? segs.join(" · ") : null;
    },
  },
  { key: "CraneYN", label: "Crane", group: "commercial", format: (p) => yes(p, "CraneYN") },
  // "No" is a real answer for rail access on industrial — verbatim, not gated to Yes.
  { key: "Rail", label: "Rail", group: "commercial", format: (p) => str(p, "Rail") },
  { key: "OutsideStorageYN", label: "Outside Storage", group: "commercial", format: (p) => yes(p, "OutsideStorageYN") },
  { key: "HoursDaysOfOperationDescription", label: "Hours of Operation", group: "commercial", format: (p) => str(p, "HoursDaysOfOperationDescription") },
  { key: "SeatingCapacity", label: "Seating Capacity", group: "commercial", format: (p) => posNum(p, "SeatingCapacity") },
  { key: "NumberOfFullTimeEmployees", label: "Full-Time Employees", group: "commercial", format: (p) => posNum(p, "NumberOfFullTimeEmployees") },
  { key: "FranchiseYN", label: "Franchise", group: "commercial", format: (p) => yes(p, "FranchiseYN") },
  { key: "LiquorLicenseYN", label: "Liquor License", group: "commercial", format: (p) => yes(p, "LiquorLicenseYN") },
  { key: "FinancialStatementAvailableYN", label: "Financials Available", group: "commercial", format: (p) => yes(p, "FinancialStatementAvailableYN") },

  // ── Commercial Financials (group gated by isCommercialClass) ──
  // Values are agent-entered income-statement figures, rendered verbatim (money).
  { key: "GrossRevenue", label: "Gross Revenue", group: "commercialFinancials", format: (p) => money(p, "GrossRevenue") },
  { key: "OperatingExpense", label: "Operating Expenses", group: "commercialFinancials", format: (p) => money(p, "OperatingExpense") },
  { key: "TaxesExpense", label: "Taxes Expense", group: "commercialFinancials", format: (p) => money(p, "TaxesExpense") },
  { key: "InsuranceExpense", label: "Insurance Expense", group: "commercialFinancials", format: (p) => money(p, "InsuranceExpense") },
  { key: "VacancyAllowance", label: "Vacancy Allowance", group: "commercialFinancials", format: (p) => money(p, "VacancyAllowance") },
  { key: "EstimatedInventoryValueAtCost", label: "Inventory Value (at cost)", group: "commercialFinancials", format: (p) => money(p, "EstimatedInventoryValueAtCost") },
  { key: "PercentBuilding", label: "% of Building", group: "commercialFinancials", format: (p) => str(p, "PercentBuilding") },
  { key: "CommercialCondoFee", label: "Commercial Condo Fee", group: "commercialFinancials", format: (p) => money(p, "CommercialCondoFee") },
  // TMI rides two shapes in the feed: a dedicated TMI string, or TaxAnnualAmount
  // with TaxType="TMI" (then the Taxes group's "Annual Taxes" number IS the TMI
  // figure). Surface the dedicated field verbatim when present.
  { key: "TMI", label: "TMI", group: "commercialFinancials", format: (p) => str(p, "TMI") },

  // ── Building & Construction ──
  { key: "ConstructionMaterials", label: "Construction", group: "building", format: (p) => joined(p, "ConstructionMaterials") },
  { key: "FoundationDetails", label: "Foundation", group: "building", format: (p) => joined(p, "FoundationDetails") },
  { key: "Roof", label: "Roof", group: "building", format: (p) => joined(p, "Roof") },
  { key: "StructureType", label: "Structure", group: "building", format: (p) => joined(p, "StructureType") },
  { key: "PropertyAttachedYN", label: "Attached", group: "building", format: (p) => yes(p, "PropertyAttachedYN") },
  { key: "NewConstructionYN", label: "New Construction", group: "building", format: (p) => yes(p, "NewConstructionYN") },
  { key: "LinkYN", label: "Link Property", group: "building", format: (p) => yes(p, "LinkYN") },
  { key: "BuilderName", label: "Builder", group: "building", format: (p) => str(p, "BuilderName") },
  { key: "LivingAreaRange", label: "Approx. Square Footage", group: "building", format: (p) => str(p, "LivingAreaRange") },
  { key: "SquareFootSource", label: "Sqft Source", group: "building", format: (p) => str(p, "SquareFootSource") },

  // ── Interior ──
  { key: "InteriorFeatures", label: "Interior Features", group: "interior", format: (p) => joined(p, "InteriorFeatures") },
  {
    key: "FireplaceYN",
    label: "Fireplace",
    group: "interior",
    format: (p) => {
      const features = joined(p, "FireplaceFeatures");
      const count = num(p, "FireplacesTotal");
      if (features) return count && count > 1 ? `${count} · ${features}` : features;
      if (p["FireplaceYN"] === true) return count && count > 1 ? `${count}` : "Yes";
      if (count && count > 0) return String(count);
      return null;
    },
  },
  { key: "CentralVacuumYN", label: "Central Vacuum", group: "interior", format: (p) => yes(p, "CentralVacuumYN") },
  { key: "EnsuiteLaundryYN", label: "Ensuite Laundry", group: "interior", format: (p) => yes(p, "EnsuiteLaundryYN") },
  { key: "LaundryFeatures", label: "Laundry Access", group: "interior", format: (p) => joined(p, "LaundryFeatures") },
  { key: "DenFamilyroomYN", label: "Family Room", group: "interior", format: (p) => yes(p, "DenFamilyroomYN") },
  {
    key: "ElevatorYN",
    label: "Elevator",
    group: "interior",
    format: (p) => str(p, "ElevatorType") ?? yes(p, "ElevatorYN"),
  },
  { key: "Furnished", label: "Furnished", group: "interior", format: (p) => str(p, "Furnished") },
  { key: "AccessibilityFeatures", label: "Accessibility", group: "interior", format: (p) => joined(p, "AccessibilityFeatures") },
  { key: "SeniorCommunityYN", label: "Retirement Community", group: "interior", format: (p) => yes(p, "SeniorCommunityYN") },

  // ── Exterior, Lot & Land ──
  { key: "ExteriorFeatures", label: "Exterior Features", group: "exterior", format: (p) => joined(p, "ExteriorFeatures") },
  { key: "LotShape", label: "Lot Shape", group: "exterior", format: (p) => str(p, "LotShape") },
  { key: "LotIrregularities", label: "Lot Irregularities", group: "exterior", format: (p) => str(p, "LotIrregularities") },
  { key: "LotFeatures", label: "Lot Features", group: "exterior", format: (p) => joined(p, "LotFeatures") },
  { key: "LotSizeRangeAcres", label: "Acreage", group: "exterior", format: (p) => str(p, "LotSizeRangeAcres") },
  { key: "PoolFeatures", label: "Pool", group: "exterior", format: (p) => joined(p, "PoolFeatures") },
  { key: "SpaYN", label: "Spa / Hot Tub", group: "exterior", format: (p) => yes(p, "SpaYN") },
  { key: "View", label: "View", group: "exterior", format: (p) => joined(p, "View") },
  {
    key: "WaterfrontYN",
    label: "Waterfront",
    group: "exterior",
    format: (p) =>
      joined(p, "Waterfront") ?? joined(p, "WaterfrontFeatures") ?? yes(p, "WaterfrontYN"),
  },
  { key: "WaterBodyName", label: "Body of Water", group: "exterior", format: (p) => str(p, "WaterBodyName") },
  { key: "Topography", label: "Topography", group: "exterior", format: (p) => joined(p, "Topography") },
  { key: "OtherStructures", label: "Other Structures", group: "exterior", format: (p) => joined(p, "OtherStructures") },
  { key: "GarageType", label: "Garage Type", group: "exterior", format: (p) => str(p, "GarageType") },
  {
    key: "CoveredSpaces",
    label: "Garage Spaces",
    group: "exterior",
    format: (p) => {
      const v = num(p, "CoveredSpaces");
      return v !== null && v > 0 ? String(v) : null;
    },
  },
  {
    key: "ParkingSpaces",
    label: "Drive Parking",
    group: "exterior",
    format: (p) => {
      const v = num(p, "ParkingSpaces");
      return v !== null && v > 0 ? String(v) : null;
    },
  },
  { key: "ParkingFeatures", label: "Parking Features", group: "exterior", format: (p) => joined(p, "ParkingFeatures") },
  {
    key: "CommunityFeatures",
    label: "Area Influences",
    group: "exterior",
    // Deduped union of the two feed fields carrying the same concept (case-insensitive).
    format: (p) => {
      const items = [...list(p, "CommunityFeatures"), ...list(p, "PropertyFeatures")];
      const seen = new Set<string>();
      const uniq = items.filter((v) => {
        const k = v.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return uniq.length > 0 ? uniq.join(" · ") : null;
    },
  },
  {
    key: "ZoningDesignation",
    label: "Zoning",
    group: "exterior",
    format: (p) => str(p, "ZoningDesignation") ?? str(p, "Zoning"),
  },
  // TRREB names the key "...Ft" but its official display name is "Water Frontage (metres)".
  // Value rendered verbatim — do NOT add a unit conversion here without PROPTX clarification.
  { key: "WaterFrontageFt", label: "Water Frontage (m)", group: "exterior", format: (p) => str(p, "WaterFrontageFt") },
  { key: "Shoreline", label: "Shoreline", group: "exterior", format: (p) => joined(p, "Shoreline") },
  { key: "ShorelineAllowance", label: "Shoreline Allowance", group: "exterior", format: (p) => str(p, "ShorelineAllowance") },
  { key: "AccessToProperty", label: "Access", group: "exterior", format: (p) => joined(p, "AccessToProperty") },
  { key: "Winterized", label: "Winterized", group: "exterior", format: (p) => str(p, "Winterized") },
  { key: "IslandYN", label: "Island", group: "exterior", format: (p) => yes(p, "IslandYN") },

  // ── Condo & Building (group gated by isCondoClass) ──
  { key: "AssociationAmenities", label: "Building Amenities", group: "condo", format: (p) => joined(p, "AssociationAmenities") },
  { key: "BalconyType", label: "Balcony", group: "condo", format: (p) => str(p, "BalconyType") },
  { key: "Exposure", label: "Exposure", group: "condo", format: (p) => str(p, "Exposure") },
  {
    key: "Locker",
    label: "Locker",
    group: "condo",
    format: (p) => {
      const parts = [
        str(p, "Locker"),
        str(p, "LockerLevel") ? `Level ${str(p, "LockerLevel")}` : null,
        str(p, "LockerUnit") ? `Unit ${str(p, "LockerUnit")}` : null,
        str(p, "LockerNumber") ? `#${str(p, "LockerNumber")}` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : null;
    },
  },
  { key: "PetsAllowed", label: "Pets", group: "condo", format: (p) => joined(p, "PetsAllowed") },
  { key: "AssociationFeeIncludes", label: "Fee Includes", group: "condo", format: (p) => joined(p, "AssociationFeeIncludes") },
  { key: "CondoCorpNumber", label: "Condo Corp #", group: "condo", format: (p) => str(p, "CondoCorpNumber") },
  { key: "AssociationName", label: "Registry Office", group: "condo", format: (p) => str(p, "AssociationName") },
  { key: "PropertyManagementCompany", label: "Property Management", group: "condo", format: (p) => str(p, "PropertyManagementCompany") },
  { key: "LegalStories", label: "Level", group: "condo", format: (p) => str(p, "LegalStories") },

  // ── Lease Terms (group gated by isLeaseTransaction) ──
  { key: "RentIncludes", label: "Included in Rent", group: "lease", format: (p) => joined(p, "RentIncludes") },
  { key: "LeaseTerm", label: "Lease Term", group: "lease", format: (p) => str(p, "LeaseTerm") },
  { key: "MinimumRentalTermMonths", label: "Min. Term (months)", group: "lease", format: (p) => posNum(p, "MinimumRentalTermMonths") },
  { key: "MaximumRentalMonthsTerm", label: "Max. Term (months)", group: "lease", format: (p) => posNum(p, "MaximumRentalMonthsTerm") },
  { key: "DepositRequired", label: "Deposit Required", group: "lease", format: (p) => yes(p, "DepositRequired") },
  { key: "RentalApplicationYN", label: "Application Required", group: "lease", format: (p) => yes(p, "RentalApplicationYN") },
  { key: "CreditCheckYN", label: "Credit Check", group: "lease", format: (p) => yes(p, "CreditCheckYN") },
  { key: "ReferencesRequiredYN", label: "References Required", group: "lease", format: (p) => yes(p, "ReferencesRequiredYN") },
  { key: "EmploymentLetterYN", label: "Employment Letter", group: "lease", format: (p) => yes(p, "EmploymentLetterYN") },
  { key: "PortionPropertyLease", label: "Portion for Lease", group: "lease", format: (p) => joined(p, "PortionPropertyLease") },
  { key: "PortionLeaseComments", label: "Portion Notes", group: "lease", format: (p) => str(p, "PortionLeaseComments") },
  { key: "PrivateEntranceYN", label: "Private Entrance", group: "lease", format: (p) => yes(p, "PrivateEntranceYN") },

  // ── Utilities & Systems ──
  {
    key: "WaterSource",
    label: "Water",
    group: "utilities",
    format: (p) => joined(p, "WaterSource") ?? str(p, "Water"),
  },
  { key: "Sewer", label: "Sewer", group: "utilities", format: (p) => joined(p, "Sewer") },
  { key: "ElectricYNA", label: "Hydro", group: "utilities", format: (p) => str(p, "ElectricYNA") },
  { key: "CableYNA", label: "Cable", group: "utilities", format: (p) => str(p, "CableYNA") },
  { key: "GasYNA", label: "Gas", group: "utilities", format: (p) => str(p, "GasYNA") },
  { key: "AlternativePower", label: "Alternative Power", group: "utilities", format: (p) => joined(p, "AlternativePower") },
  {
    key: "Amps",
    label: "Amps",
    group: "utilities",
    format: (p) => {
      const v = num(p, "Amps");
      return v !== null && v > 0 ? String(v) : null;
    },
  },
  {
    key: "Volts",
    label: "Volts",
    group: "utilities",
    format: (p) => {
      const v = num(p, "Volts");
      return v !== null && v > 0 ? String(v) : null;
    },
  },
  { key: "RuralUtilities", label: "Rural Services", group: "utilities", format: (p) => joined(p, "RuralUtilities") },
  { key: "SecurityFeatures", label: "Sprinklers / Security", group: "utilities", format: (p) => joined(p, "SecurityFeatures") },

  // ── Taxes & Assessment ──
  {
    key: "TaxAnnualAmount",
    label: "Annual Taxes",
    group: "taxes",
    format: (p) => {
      const amount = money(p, "TaxAnnualAmount");
      if (!amount) return null;
      const year = num(p, "TaxYear");
      return year ? `${amount} (${year})` : amount;
    },
  },
  {
    key: "TaxAssessedValue",
    label: "Assessed Value",
    group: "taxes",
    format: (p) => {
      const amount = money(p, "TaxAssessedValue");
      if (!amount) return null;
      const year = num(p, "AssessmentYear");
      return year ? `${amount} (${year})` : amount;
    },
  },
  { key: "TaxType", label: "Tax Type", group: "taxes", format: (p) => str(p, "TaxType") },
  { key: "ParcelNumber", label: "PIN #", group: "taxes", format: (p) => str(p, "ParcelNumber") },
  { key: "DevelopmentChargesPaid", label: "Development Charges Paid", group: "taxes", format: (p) => joined(p, "DevelopmentChargesPaid") },
  { key: "RollNumber", label: "Assessment Roll #", group: "taxes", format: (p) => str(p, "RollNumber") },
  { key: "TaxLegalDescription", label: "Legal Description", group: "taxes", format: (p) => str(p, "TaxLegalDescription") },
  {
    key: "AdditionalMonthlyFee",
    label: "POTL Monthly Fee",
    group: "taxes",
    format: (p) => {
      const amount = money(p, "AdditionalMonthlyFee");
      if (!amount) return null;
      const freq = str(p, "AdditionalMonthlyFeeFrequency");
      return freq ? `${amount} · ${freq}` : amount;
    },
  },

  // ── Transaction & Possession ──
  { key: "PossessionType", label: "Possession", group: "transaction", format: (p) => str(p, "PossessionType") },
  { key: "PossessionDetails", label: "Possession Notes", group: "transaction", format: (p) => str(p, "PossessionDetails") },
  { key: "OccupantType", label: "Occupancy", group: "transaction", format: (p) => str(p, "OccupantType") },
  { key: "HSTApplication", label: "HST", group: "transaction", format: (p) => joined(p, "HSTApplication") },
  { key: "ChattelsYN", label: "Chattels Included", group: "transaction", format: (p) => yes(p, "ChattelsYN") },
  {
    key: "VirtualTourURLUnbranded",
    label: "Virtual Tour",
    group: "transaction",
    format: (p) => (safeUrl(p, "VirtualTourURLUnbranded") ? "View tour" : null),
    href: (p) => safeUrl(p, "VirtualTourURLUnbranded"),
  },
  {
    key: "VirtualTourURLBranded",
    label: "Virtual Tour (branded)",
    group: "transaction",
    format: (p) => (safeUrl(p, "VirtualTourURLBranded") ? "View tour" : null),
    href: (p) => safeUrl(p, "VirtualTourURLBranded"),
  },
  {
    key: "SurveyAvailableYN",
    label: "Survey",
    group: "transaction",
    format: (p) => {
      const type = str(p, "SurveyType");
      if (p["SurveyAvailableYN"] === true) return type ? `Yes · ${type}` : "Yes";
      return type;
    },
  },
  { key: "VendorPropertyInfoStatement", label: "Seller Property Info Statement", group: "transaction", format: (p) => yes(p, "VendorPropertyInfoStatement") },
  // VOW-payload extras — absent from active IDX listings, they self-omit there
  // and surface on sold pages where the payload carries them.
  { key: "Inclusions", label: "Inclusions", group: "transaction", format: (p) => str(p, "Inclusions") },
  { key: "Exclusions", label: "Exclusions", group: "transaction", format: (p) => str(p, "Exclusions") },
  { key: "AssignmentYN", label: "Assignment", group: "transaction", format: (p) => yes(p, "AssignmentYN") },
  { key: "FractionalOwnershipYN", label: "Fractional Ownership", group: "transaction", format: (p) => yes(p, "FractionalOwnershipYN") },

  // ── Risk & Disclosures ──
  {
    key: "UFFI",
    label: "UFFI",
    group: "risk",
    format: (p) => str(p, "UFFI"),
    flag: (p) => concerning(list(p, "UFFI")),
  },
  {
    key: "Disclosures",
    label: "Easements / Restrictions",
    group: "risk",
    format: (p) => {
      const items = withoutUnknown(list(p, "Disclosures"));
      return items.length > 0 ? items.join(" · ") : null;
    },
    flag: (p) => concerning(withoutUnknown(list(p, "Disclosures"))),
  },
  {
    key: "LocalImprovements",
    label: "Local Improvements",
    group: "risk",
    format: (p) => yes(p, "LocalImprovements"),
    flag: (p) => p["LocalImprovements"] === true,
  },
  {
    key: "LocalImprovementsComments",
    label: "Local Improvements Notes",
    group: "risk",
    format: (p) => str(p, "LocalImprovementsComments"),
  },
  {
    key: "SpecialDesignation",
    label: "Special Designation",
    group: "risk",
    format: (p) => {
      const items = withoutUnknown(list(p, "SpecialDesignation"));
      return items.length > 0 ? items.join(" · ") : null;
    },
    flag: (p) => concerning(withoutUnknown(list(p, "SpecialDesignation"))),
  },
  { key: "SeasonalDwelling", label: "Seasonal Dwelling", group: "risk", format: (p) => yes(p, "SeasonalDwelling") },
  // Carrying-cost gotchas: contracts/rentals that transfer with the property.
  {
    key: "UnderContract",
    label: "Items Under Contract",
    group: "risk",
    format: (p) => joined(p, "UnderContract"),
    flag: (p) => concerning(list(p, "UnderContract")),
  },
  {
    key: "LeaseToOwnEquipment",
    label: "Lease-To-Own Equipment",
    group: "risk",
    format: (p) => joined(p, "LeaseToOwnEquipment"),
    flag: (p) => concerning(list(p, "LeaseToOwnEquipment")),
  },
  {
    key: "RentalItems",
    label: "Rental Items",
    group: "risk",
    format: (p) => str(p, "RentalItems"),
    flag: (p) => concerning(list(p, "RentalItems")),
  },
];

const DEFAULT_ORDER: DatasheetGroupId[] = GROUPS.map((g) => g.id);

/**
 * Resolve the registry against a payload. Only populated rows are returned;
 * groups with zero rows are dropped. `order` is the future persona-lens /
 * per-user reorder seam — it may reorder groups but can never add or remove
 * fields (per-user hiding is compliance-gated; see spec).
 *
 * `order` is normalized: duplicates are deduped, unknown ids are ignored, and
 * any DEFAULT_ORDER groups missing from it are appended afterwards in default
 * order — a partial `order` reorders its listed groups to the front but never
 * removes the rest.
 */
export function buildDatasheet(p: RawPayload, order?: DatasheetGroupId[]): ResolvedGroup[] {
  const requested = (order ?? []).filter(
    (id, i, arr) => DEFAULT_ORDER.includes(id) && arr.indexOf(id) === i,
  );
  const groupOrder = [...requested, ...DEFAULT_ORDER.filter((id) => !requested.includes(id))];
  const out: ResolvedGroup[] = [];
  for (const id of groupOrder) {
    const meta = GROUPS.find((g) => g.id === id);
    if (!meta) continue;
    const applies = GROUP_APPLIES[id];
    if (applies && !applies(p)) continue;
    const rows: ResolvedRow[] = [];
    for (const f of FIELDS) {
      if (f.group !== id) continue;
      let value: string | null = null;
      try {
        value = f.format(p);
      } catch {
        value = null; // formatter must never take the page down on garbage feed data
      }
      if (value === null) continue;
      const row: ResolvedRow = { key: f.key, label: f.label, value };
      if (f.href) {
        try {
          const href = f.href(p);
          if (href) row.href = href;
        } catch {
          /* omit link, keep row */
        }
      }
      if (f.flag) {
        try {
          row.flagged = f.flag(p);
        } catch {
          row.flagged = false;
        }
      }
      rows.push(row);
    }
    if (rows.length > 0) out.push({ group: meta, rows });
  }
  return out;
}
