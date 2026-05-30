import type { FilterDef, FilterValue, UniversalFilterState } from "./types";

const PRICE_MIN = 0;
const PRICE_MAX = 3_000_000;

const fmtPrice = (v: number): string =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`
    : `$${Math.round(v / 1000)}k`;

/**
 * CORE_FILTERS — the universal "what" filters, defined as data so the bar, the
 * query builder, and (later) the add-filter palette all read one source.
 * Home Type filters PropertySubType (Detached/Semi/Townhouse/Condo) — the value
 * users actually mean by "type". Exact subtype spellings are confirmed in Task 9.
 */
export const CORE_FILTERS: FilterDef[] = [
  {
    key: "price",
    label: "Price",
    category: "Basics",
    control: "range",
    defaultPinned: true,
    defaultValue: [PRICE_MIN, PRICE_MAX],
    min: PRICE_MIN,
    max: PRICE_MAX,
    step: 25_000,
    isActive: (v) => {
      const [lo, hi] = v as [number, number];
      return lo > PRICE_MIN || hi < PRICE_MAX;
    },
    buildClause: (v) => {
      const [lo, hi] = v as [number, number];
      const parts: string[] = [];
      if (lo > PRICE_MIN) parts.push(`ListPrice:>=${Math.floor(lo)}`);
      if (hi < PRICE_MAX) parts.push(`ListPrice:<=${Math.floor(hi)}`);
      return parts.length ? parts.join(" && ") : null;
    },
    chipLabel: (v) => {
      const [lo, hi] = v as [number, number];
      if (lo > PRICE_MIN && hi < PRICE_MAX) return `${fmtPrice(lo)}–${fmtPrice(hi)}`;
      if (lo > PRICE_MIN) return `${fmtPrice(lo)}+`;
      if (hi < PRICE_MAX) return `≤${fmtPrice(hi)}`;
      return "Price";
    },
  },
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
    isActive: (v) => (v as number) > 0,
    buildClause: (v) => ((v as number) > 0 ? `BedroomsTotal:>=${v as number}` : null),
    chipLabel: (v) => ((v as number) > 0 ? `${v as number}+ Bd` : "Beds"),
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
    isActive: (v) => (v as number) > 0,
    buildClause: (v) => ((v as number) > 0 ? `BathroomsTotalInteger:>=${v as number}` : null),
    chipLabel: (v) => ((v as number) > 0 ? `${v as number}+ Ba` : "Baths"),
  },
  {
    key: "homeType",
    label: "Home Type",
    category: "Basics",
    control: "enum",
    defaultPinned: true,
    defaultValue: [],
    facetField: "PropertySubType",
    options: [
      { value: "Detached", label: "Detached" },
      { value: "Semi-Detached ", label: "Semi-Detached" },
      { value: "Att/Row/Townhouse", label: "Townhouse" },
      { value: "Condo Apartment", label: "Condo Apt" },
      { value: "Condo Townhouse", label: "Condo Townhouse" },
      { value: "Duplex", label: "Duplex" },
      { value: "Multiplex", label: "Multiplex" },
    ],
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
    isActive: (v) => (v as number) > 0,
    buildClause: (v) => ((v as number) > 0 ? `${o.field}:>=${v as number}` : null),
    chipLabel: (v) => ((v as number) > 0 ? `${v as number}+ ${o.unit}` : o.label),
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
  rangeFilter({ key: "lotSize", label: "Lot Size", field: "LotSqftTotal", min: 0, max: 20000, step: 500, fmt: fmtSqft }),
  rangeFilter({ key: "lotFrontage", label: "Lot Frontage", field: "LotWidth", min: 0, max: 200, step: 5, fmt: fmtFt }),
  stepperFilter({ key: "parking", label: "Parking", field: "ParkingTotal", max: 8, unit: "Parking" }),
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

/** Compose the active universal filters into one Typesense filter_by fragment ("" if none). */
export function buildUniversalFilterString(values: UniversalFilterState): string {
  const clauses: string[] = [];
  for (const def of ALL_FILTERS) {
    const value = values[def.key] ?? def.defaultValue;
    const clause = def.buildClause(value);
    if (clause) clauses.push(clause);
  }
  return clauses.join(" && ");
}
