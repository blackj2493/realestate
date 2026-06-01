/**
 * Fundamental search axes for the terminal — the two "hard" segmentations that
 * sit BEFORE the persona/composable filters and gate everything downstream:
 *   • transaction mode — For Sale vs For Rent (TransactionType)
 *   • property class    — Residential vs Commercial (PropertyType)
 *
 * Plus the class-scoped Property Type (PropertySubType) option sets used by the
 * picker. All values are the EXACT live Typesense spellings (verified against the
 * `properties` collection facet counts) — including the trailing space on
 * "Semi-Detached " and "Commercial Retail" (space, not slash). Backtick-quote any
 * value with a space/slash when building filter_by (Typesense mis-parses unquoted).
 */
import type { FilterOption } from "./types";

export type TransactionMode = "sale" | "rent";
export type PropertyClass = "residential" | "commercial";

/** TransactionType values as stored on every doc. */
const TRANSACTION_VALUE: Record<TransactionMode, string> = {
  sale: "For Sale",
  rent: "For Lease",
};

/** Exact-match TransactionType clause; backtick-quoted (the value has a space). */
export function buildTransactionClause(mode: TransactionMode): string {
  return `TransactionType:=\`${TRANSACTION_VALUE[mode]}\``;
}

/**
 * Property-class gate. The live PropertyType facet is exactly
 * {"Residential Freehold", "Residential Condo & Other", "Commercial", "Residential"}.
 * Commercial is the only non-residential class, so residential = "not Commercial":
 * this stays correct no matter which residential spelling a doc carries and never
 * drifts as TRREB adds residential sub-classes. "Commercial" has no space → no quote.
 */
export function buildClassClause(cls: PropertyClass): string {
  return cls === "commercial" ? "PropertyType:=Commercial" : "PropertyType:!=Commercial";
}

/**
 * Price floor. For sales, ListPrice is a sale price → keep the $100k floor that
 * drops $0/$1 placeholder listings. For rentals, ListPrice is a MONTHLY rent
 * (~$2k) → a $100k floor would hide every rental, so floor at $1 (drop $0 only).
 */
export function priceFloorClause(mode: TransactionMode): string {
  return mode === "rent" ? "ListPrice:>=1" : "ListPrice:>=100000";
}

/**
 * The persona/investor analytics layer (cap rate, True DOM, capital burn, yield
 * map shading) is built for residential SALES only. Rentals and commercial are
 * "basic browse" for now (metrics deferred) — so the persona preset + investor
 * chips, the persona filter clause and the persona sort are all gated on this.
 */
export function isInvestorLayerActive(mode: TransactionMode, cls: PropertyClass): boolean {
  return mode === "sale" && cls === "residential";
}

/**
 * Residential Property Type options (single exact PropertySubType spelling each, so
 * the picker's live facet counts line up). Ordered by live volume.
 */
export const RESIDENTIAL_TYPE_OPTIONS: FilterOption[] = [
  { value: "Detached", label: "Detached" },
  { value: "Semi-Detached ", label: "Semi-Detached" }, // trailing space is live data
  { value: "Att/Row/Townhouse", label: "Townhouse" },
  { value: "Condo Townhouse", label: "Condo Townhouse" },
  { value: "Condo Apartment", label: "Condo Apt" },
  { value: "Link", label: "Link" },
  { value: "Duplex", label: "Duplex" },
  { value: "Multiplex", label: "Multiplex" },
  { value: "Vacant Land", label: "Vacant Land" },
];

/** Commercial Property Type options (basic set; exact live spellings). */
export const COMMERCIAL_TYPE_OPTIONS: FilterOption[] = [
  { value: "Commercial Retail", label: "Retail" },
  { value: "Office", label: "Office" },
  { value: "Industrial", label: "Industrial" },
  { value: "Sale Of Business", label: "Sale of Business" },
  { value: "Investment", label: "Investment" },
  { value: "Land", label: "Land" },
  { value: "Farm", label: "Farm" },
  { value: "Store W Apt/Office", label: "Store w/ Apt" },
];

export function typeOptionsForClass(cls: PropertyClass): FilterOption[] {
  return cls === "commercial" ? COMMERCIAL_TYPE_OPTIONS : RESIDENTIAL_TYPE_OPTIONS;
}
