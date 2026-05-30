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

export const FILTERS_BY_KEY: Record<string, FilterDef> = Object.fromEntries(
  CORE_FILTERS.map((f) => [f.key, f])
);

/** Fresh default-value map (arrays cloned so store state never shares references). */
export function makeDefaultUniversalFilters(): UniversalFilterState {
  const out: UniversalFilterState = {};
  for (const f of CORE_FILTERS) {
    out[f.key] = Array.isArray(f.defaultValue) ? ([...f.defaultValue] as FilterValue) : f.defaultValue;
  }
  return out;
}

/** Compose the active universal filters into one Typesense filter_by fragment ("" if none). */
export function buildUniversalFilterString(values: UniversalFilterState): string {
  const clauses: string[] = [];
  for (const def of CORE_FILTERS) {
    const value = values[def.key] ?? def.defaultValue;
    const clause = def.buildClause(value);
    if (clause) clauses.push(clause);
  }
  return clauses.join(" && ");
}
