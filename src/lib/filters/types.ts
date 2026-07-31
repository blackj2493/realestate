export type FilterCategory = "Basics" | "Investor" | "Property" | "Location";
export type FilterControlKind = "range" | "stepper" | "enum" | "bands";

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

/**
 * A band range carries real sqft bounds plus how strictly to read them.
 *
 * The bounds are always in actual square feet, never band indices — so switching
 * the displayed scale (house bands vs condo bands) is pure UI and can never
 * silently change what the user asked for.
 */
export interface BandRangeValue {
  /** Inclusive lower bound, sqft. */
  lo: number;
  /** Exclusive upper bound, sqft. */
  hi: number;
  /**
   * Count a listing whose band merely OVERLAPS [lo, hi) as a match, rather than
   * requiring the band to sit entirely inside it. TRREB publishes size as a band,
   * so a listing filed "1000-1199" against a 1,100+ search is a genuine unknown —
   * `loose` is the user deciding whether unknowns are in or out.
   */
  loose: boolean;
  /** Also surface listings that report no size at all. */
  unsized: boolean;
}

/** A range carries [min, max]; a stepper carries a count (+exact flag); an enum carries selected values;
 *  a bands control carries sqft bounds plus its strictness flags. */
export type FilterValue = [number, number] | number | string[] | StepperValue | BandRangeValue;

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
