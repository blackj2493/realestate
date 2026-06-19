export type FilterCategory = "Basics" | "Investor" | "Property" | "Location";
export type FilterControlKind = "range" | "stepper" | "enum";

export interface FilterOption {
  value: string;
  label: string;
}

/** A stepper carries a count plus whether it's an *exact* match (vs. a minimum).
 *  A bare number is read as { n, exact:false } — back-compat for defaults and any
 *  previously-stored state (see `readStepper` in filterRegistry). */
export interface StepperValue {
  n: number;
  exact: boolean;
}

/** A range carries [min, max]; a stepper carries a count (+exact flag); an enum carries selected values. */
export type FilterValue = [number, number] | number | string[] | StepperValue;

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
