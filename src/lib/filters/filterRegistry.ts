import type { FilterDef, FilterValue, StepperValue, UniversalFilterState } from "./types";
import { RESIDENTIAL_TYPE_OPTIONS, priceConfig, type RangeConfig } from "./fundamentals";
import { DIRECTION_OPTIONS } from "@/lib/listings/directionFaces";

const fmtPrice = (v: number): string =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`
    : v >= 10_000
      ? `$${Math.round(v / 1000)}k`
      : `$${v.toLocaleString("en-US")}`; // rents read as "$1,800", not "$2k"

/**
 * Price range filter, parameterised by transaction mode (sale vs rent bounds —
 * see priceConfig). FilterBar renders the mode-scoped def; the query path builds
 * the clause from the same config so bounds never drift between UI and filter.
 */
export function makePriceDef(cfg: RangeConfig): FilterDef {
  const { min, max, step } = cfg;
  return {
    key: "price",
    label: "Price",
    category: "Basics",
    control: "range",
    defaultPinned: true,
    defaultValue: [min, max],
    min,
    max,
    step,
    field: "ListPrice",
    formatValue: fmtPrice,
    isActive: (v) => {
      const [lo, hi] = v as [number, number];
      return lo > min || hi < max;
    },
    buildClause: (v) => {
      const [lo, hi] = v as [number, number];
      const parts: string[] = [];
      if (lo > min) parts.push(`ListPrice:>=${Math.floor(lo)}`);
      if (hi < max) parts.push(`ListPrice:<=${Math.floor(hi)}`);
      return parts.length ? parts.join(" && ") : null;
    },
    chipLabel: (v) => {
      const [lo, hi] = v as [number, number];
      if (lo > min && hi < max) return `${fmtPrice(lo)}–${fmtPrice(hi)}`;
      if (lo > min) return `${fmtPrice(lo)}+`;
      if (hi < max) return `≤${fmtPrice(hi)}`;
      return "Price";
    },
  };
}

/**
 * Beds filter on ABOVE-GRADE bedrooms (what users mean by "a 4-bed house"), not
 * the inflated total — a "2+2" (2 above, 2 below) is a 2-bed for filtering, so it
 * must NOT surface under "4 beds". Falls back to BedroomsTotal only when the
 * above-grade value is missing (stored as 0), mirroring the card's `bedsLabel`
 * fallback so the filter and the displayed split stay consistent. ~85% of the
 * index has BedroomsAboveGrade > 0; the `=0` branch rescues the ~0.5% that carry
 * only a total. (Typesense supports the parenthesised || / && grouping.)
 */
export const aboveGradeBedsClause = (n: number): string =>
  `(BedroomsAboveGrade:>=${n} || (BedroomsAboveGrade:=0 && BedroomsTotal:>=${n}))`;

/** Exact-count variant of {@link aboveGradeBedsClause} (beds filter in "exact"
 *  mode), mirroring the same above-grade/total fallback with `:=` in place of `:>=`. */
export const exactAboveGradeBedsClause = (n: number): string =>
  `(BedroomsAboveGrade:=${n} || (BedroomsAboveGrade:=0 && BedroomsTotal:=${n}))`;

/**
 * Normalises a stepper value. A bare number means "minimum" (the default/legacy
 * shape), so existing state and the `0` defaults keep working; the object form
 * `{ n, exact }` carries the Min/Exact mode the popover now offers.
 */
export const readStepper = (v: FilterValue): StepperValue =>
  typeof v === "number" ? { n: v, exact: false } : (v as StepperValue);

/**
 * CORE_FILTERS — the universal "what" filters, defined as data so the bar, the
 * query builder, and (later) the add-filter palette all read one source.
 * Home Type filters PropertySubType (Detached/Semi/Townhouse/Condo) — the value
 * users actually mean by "type". Exact subtype spellings are confirmed in Task 9.
 */
export const CORE_FILTERS: FilterDef[] = [
  // Default (sale) price def; FilterBar swaps to the rent-scoped def in rent mode,
  // and the query path builds the price clause from the same makePriceDef config.
  makePriceDef(priceConfig("sale")),
  {
    key: "beds",
    label: "Beds",
    category: "Basics",
    control: "stepper",
    defaultPinned: true,
    defaultValue: 0,
    min: 0,
    max: 7,
    step: 1,
    isActive: (v) => readStepper(v).n > 0,
    buildClause: (v) => {
      const { n, exact } = readStepper(v);
      if (n <= 0) return null;
      return exact ? exactAboveGradeBedsClause(n) : aboveGradeBedsClause(n);
    },
    chipLabel: (v) => {
      const { n, exact } = readStepper(v);
      return n > 0 ? `${n}${exact ? "" : "+"} Bd` : "Beds";
    },
  },
  {
    key: "baths",
    label: "Baths",
    category: "Basics",
    control: "stepper",
    defaultPinned: true,
    defaultValue: 0,
    min: 0,
    max: 7,
    step: 1,
    isActive: (v) => readStepper(v).n > 0,
    buildClause: (v) => {
      const { n, exact } = readStepper(v);
      if (n <= 0) return null;
      return `BathroomsTotalInteger:${exact ? "=" : ">="}${n}`;
    },
    chipLabel: (v) => {
      const { n, exact } = readStepper(v);
      return n > 0 ? `${n}${exact ? "" : "+"} Ba` : "Baths";
    },
  },
  {
    key: "homeType",
    label: "Property Type",
    category: "Basics",
    control: "enum",
    defaultPinned: true,
    defaultValue: [],
    facetField: "PropertySubType",
    // Default (residential) option set; FilterBar swaps to the commercial set when
    // the property class is Commercial. Both live in ./fundamentals (one source).
    options: RESIDENTIAL_TYPE_OPTIONS,
    isActive: (v) => (v as string[]).length > 0,
    buildClause: (v) => {
      const vals = v as string[];
      if (!vals.length) return null;
      return `(${vals.map((s) => `PropertySubType:=\`${s}\``).join(" || ")})`;
    },
    chipLabel: (v) => {
      const vals = v as string[];
      if (!vals.length) return "Home Type";
      return vals.length === 1 ? vals[0] : `${vals.length} types`;
    },
  },
];

// ── Phase 2: factory helpers for the deeper field library ──────────────────
const fmtSqft = (v: number) => `${v.toLocaleString("en-US")} sf`;
const fmtFt = (v: number) => `${v}′`;
const fmtFee = (v: number) => `$${v}/mo`;

function enumFilter(o: {
  key: string;
  label: string;
  field: string;
  options: { value: string; label: string }[];
}): FilterDef {
  return {
    key: o.key,
    label: o.label,
    category: "Property",
    control: "enum",
    defaultPinned: false,
    defaultValue: [],
    facetField: o.field,
    options: o.options,
    isActive: (v) => (v as string[]).length > 0,
    buildClause: (v) => {
      const vals = v as string[];
      if (!vals.length) return null;
      return `(${vals.map((s) => `${o.field}:=\`${s}\``).join(" || ")})`;
    },
    chipLabel: (v) => {
      const vals = v as string[];
      if (!vals.length) return o.label;
      if (vals.length === 1) return o.options.find((x) => x.value === vals[0])?.label ?? vals[0];
      return `${vals.length} selected`;
    },
  };
}

function rangeFilter(o: {
  key: string;
  label: string;
  field: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}): FilterDef {
  return {
    key: o.key,
    label: o.label,
    category: "Property",
    control: "range",
    defaultPinned: false,
    defaultValue: [o.min, o.max],
    min: o.min,
    max: o.max,
    step: o.step,
    field: o.field,
    formatValue: o.fmt,
    isActive: (v) => {
      const [lo, hi] = v as [number, number];
      return lo > o.min || hi < o.max;
    },
    buildClause: (v) => {
      const [lo, hi] = v as [number, number];
      const parts: string[] = [];
      if (lo > o.min) parts.push(`${o.field}:>=${Math.floor(lo)}`);
      if (hi < o.max) parts.push(`${o.field}:<=${Math.floor(hi)}`);
      return parts.length ? parts.join(" && ") : null;
    },
    chipLabel: (v) => {
      const [lo, hi] = v as [number, number];
      if (lo > o.min && hi < o.max) return `${o.fmt(lo)}–${o.fmt(hi)}`;
      if (lo > o.min) return `${o.fmt(lo)}+`;
      if (hi < o.max) return `≤${o.fmt(hi)}`;
      return o.label;
    },
  };
}

function stepperFilter(o: {
  key: string;
  label: string;
  field: string;
  max: number;
  unit: string;
}): FilterDef {
  return {
    key: o.key,
    label: o.label,
    category: "Property",
    control: "stepper",
    defaultPinned: false,
    defaultValue: 0,
    min: 0,
    max: o.max,
    step: 1,
    isActive: (v) => readStepper(v).n > 0,
    buildClause: (v) => {
      const { n, exact } = readStepper(v);
      if (n <= 0) return null;
      return `${o.field}:${exact ? "=" : ">="}${n}`;
    },
    chipLabel: (v) => {
      const { n, exact } = readStepper(v);
      return n > 0 ? `${n}${exact ? "" : "+"} ${o.unit}` : o.label;
    },
  };
}

/** The deeper, opt-in field library reached via "+ Add filter". Values live-verified. */
export const MORE_FILTERS: FilterDef[] = [
  enumFilter({
    key: "basement",
    label: "Basement",
    field: "BasementType",
    options: [
      { value: "Finished", label: "Finished" },
      { value: "Unfinished", label: "Unfinished" },
      { value: "Separate Entrance", label: "Separate Entrance" },
      { value: "Walk-Out", label: "Walk-Out" },
      { value: "Finished with Walk-Out", label: "Finished + Walk-Out" },
      { value: "Apartment", label: "Apartment" },
    ],
  }),
  enumFilter({
    key: "suite",
    label: "Suite Potential",
    field: "SuiteStatus",
    options: [
      { value: "EXISTING_SUITE", label: "Existing suite" },
      { value: "POTENTIAL_CANDIDATE", label: "Potential suite" },
    ],
  }),
  enumFilter({
    key: "multiUnit",
    label: "Multi-Unit",
    field: "multi_unit_status",
    options: [
      { value: "EXISTING_MULTI_UNIT", label: "Existing multi-unit" },
      { value: "PRIME_CANDIDATE", label: "Prime candidate" },
      { value: "MARGINAL_CANDIDATE", label: "Marginal candidate" },
    ],
  }),
  enumFilter({
    key: "occupancy",
    label: "Occupancy",
    field: "OccupantType",
    options: [
      { value: "Vacant", label: "Vacant" },
      { value: "Tenant", label: "Tenant" },
      { value: "Owner", label: "Owner" },
    ],
  }),
  enumFilter({
    key: "age",
    label: "Property Age",
    field: "ApproximateAge",
    options: [
      { value: "New", label: "New" },
      { value: "0-5", label: "0-5 yrs" },
      { value: "6-15", label: "6-15 yrs" },
      { value: "16-30", label: "16-30 yrs" },
      { value: "31-50", label: "31-50 yrs" },
      { value: "51-99", label: "51-99 yrs" },
      { value: "100+", label: "100+ yrs" },
    ],
  }),
  enumFilter({
    key: "faces",
    label: "Faces",
    field: "DirectionFaces",
    options: DIRECTION_OPTIONS,
  }),
  rangeFilter({ key: "lotSize", label: "Lot Size", field: "LotSqftTotal", min: 0, max: 20000, step: 500, fmt: fmtSqft }),
  rangeFilter({ key: "lotFrontage", label: "Lot Frontage", field: "LotWidth", min: 0, max: 200, step: 5, fmt: fmtFt }),
  stepperFilter({ key: "parking", label: "Parking", field: "ParkingTotal", max: 8, unit: "Parking" }),
  // Covered (garage) spaces — distinct from total Parking, which includes the
  // driveway. CoveredSpaces is already an indexed int32, so this is filter-only.
  stepperFilter({ key: "garage", label: "Garage", field: "CoveredSpaces", max: 4, unit: "Garage" }),
  stepperFilter({ key: "kitchens", label: "Kitchens", field: "KitchensTotal", max: 4, unit: "Kitchen" }),
  rangeFilter({ key: "maintFee", label: "Maint. Fee", field: "AssociationFee", min: 0, max: 2000, step: 50, fmt: fmtFee }),
];

/** Pinned-by-default core + the opt-in deeper library. */
export const ALL_FILTERS: FilterDef[] = [...CORE_FILTERS, ...MORE_FILTERS];

/** Low-cardinality enum fields already facet:true — requested so per-option counts show. */
export const FACET_FIELDS = [
  "PropertySubType",
  "BasementType",
  "SuiteStatus",
  "multi_unit_status",
  "OccupantType",
  "ApproximateAge",
  "DirectionFaces",
];

export const FILTERS_BY_KEY: Record<string, FilterDef> = Object.fromEntries(
  ALL_FILTERS.map((f) => [f.key, f])
);

/** Fresh default-value map (arrays cloned so store state never shares references). */
export function makeDefaultUniversalFilters(): UniversalFilterState {
  const out: UniversalFilterState = {};
  for (const f of ALL_FILTERS) {
    out[f.key] = Array.isArray(f.defaultValue) ? ([...f.defaultValue] as FilterValue) : f.defaultValue;
  }
  return out;
}

/**
 * Compose the active universal filters into one Typesense filter_by fragment
 * ("" if none). `exclude` drops specific keys — used by the distribution
 * histogram (a field's own clause is excluded so its bars don't self-collapse)
 * and by the query path (price is built transaction-aware, separately).
 */
export function buildUniversalFilterString(
  values: UniversalFilterState,
  opts?: { exclude?: string[] }
): string {
  const excluded = new Set(opts?.exclude ?? []);
  const clauses: string[] = [];
  for (const def of ALL_FILTERS) {
    if (excluded.has(def.key)) continue;
    const value = values[def.key] ?? def.defaultValue;
    const clause = def.buildClause(value);
    if (clause) clauses.push(clause);
  }
  return clauses.join(" && ");
}
