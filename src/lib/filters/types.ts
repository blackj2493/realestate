export type FilterCategory = "Basics" | "Investor" | "Property" | "Location";
export type FilterControlKind = "range" | "stepper" | "enum";

export interface FilterOption {
  value: string;
  label: string;
}

/** A range carries [min, max]; a stepper carries a single number; an enum carries selected values. */
export type FilterValue = [number, number] | number | string[];

export interface FilterDef {
  key: string;
  label: string;
  category: FilterCategory;
  control: FilterControlKind;
  defaultPinned: boolean;
  defaultValue: FilterValue;
  // range controls
  min?: number;
  max?: number;
  step?: number;
  // enum controls
  options?: FilterOption[];
  /** Typesense facet field for live enum counts. */
  facetField?: string;
  /** Typesense numeric field this range filters on — drives the distribution
   *  histogram. Omitted ⇒ no histogram (e.g. unindexed AssociationFee). */
  field?: string;
  /** Formats a single endpoint value (range controls) — used for aria-valuetext. */
  formatValue?: (v: number) => string;
  isActive: (value: FilterValue) => boolean;
  /** Emits a Typesense filter_by fragment, or null when the value is at default. */
  buildClause: (value: FilterValue) => string | null;
  chipLabel: (value: FilterValue) => string;
}

export type UniversalFilterState = Record<string, FilterValue>;
