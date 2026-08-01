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

/** Slider bounds for a numeric range control. */
export interface RangeConfig {
  min: number;
  max: number;
  step: number;
}

/**
 * Price slider is transaction-aware: ListPrice is a SALE price for sale (0–$3M,
 * $25k steps) but a MONTHLY RENT for lease (~$2k) — a 0–3M/$25k slider can't
 * express a rent, so rent gets 0–$12k / $100 steps.
 */
const PRICE_CONFIG: Record<TransactionMode, RangeConfig> = {
  sale: { min: 0, max: 3_000_000, step: 25_000 },
  rent: { min: 0, max: 12_000, step: 100 },
};

export function priceConfig(mode: TransactionMode): RangeConfig {
  return PRICE_CONFIG[mode];
}

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
 * Class check for a single listing payload (detail page, cards). Mirrors
 * buildClassClause: "Commercial" is the only non-residential PropertyType, so
 * exact-match is the same rule the terminal filters by. Trimmed for feed safety.
 */
export function isCommercialProperty(propertyType?: string | null): boolean {
  return (propertyType ?? "").trim() === "Commercial";
}

/** Sale placeholder floor: a real sale is never under $100k, a $1 row is a stub. */
export const SALE_PRICE_FLOOR = 100_000;
/** Rent placeholder floor: a monthly rent is ~$2k, so only $0 is a stub. */
export const RENT_PRICE_FLOOR = 1;

/**
 * Price floor. For sales, ListPrice is a sale price → keep the $100k floor that
 * drops $0/$1 placeholder listings. For rentals, ListPrice is a MONTHLY rent
 * (~$2k) → a $100k floor would hide every rental, so floor at $1 (drop $0 only).
 */
export function priceFloorClause(mode: TransactionMode): string {
  return mode === "rent"
    ? `ListPrice:>=${RENT_PRICE_FLOOR}`
    : `ListPrice:>=${SALE_PRICE_FLOOR}`;
}

/**
 * Placeholder-price floor for surfaces that span BOTH transaction types — the
 * search typeahead above all, where the user has typed an address and expects to
 * find it whether it is for sale or for lease.
 *
 * {@link priceFloorClause} picks a floor from the mode the user is BROWSING in.
 * This one picks it from the mode each DOCUMENT declares, using the feed's own
 * `TransactionType` field, so nothing has to be inferred from price at all.
 *
 * That distinction was a real bug: the typeahead hardcoded the sale floor, and
 * because a lease's ListPrice is a monthly rent (~$2k, well under $100k) it hid
 * 23,989 of 23,990 lease listings and every one of the 362 `For Sub-Lease` rows —
 * 28% of the index. Worse than invisible: with the exact match filtered out,
 * Typesense drops query tokens and returns fuzzy matches instead, so a searched
 * address came back as a list of unrelated streets.
 *
 * The non-sale side is written as `!=` rather than an OR over the known lease
 * values on purpose. `For Sub-Lease` was already in the feed and unaccounted for;
 * enumerating would silently drop the next value TRREB adds, which is exactly the
 * failure being fixed here.
 */
export function anyTransactionPriceFloor(): string {
  const sale = TRANSACTION_VALUE.sale;
  return (
    `((TransactionType:=\`${sale}\` && ListPrice:>=${SALE_PRICE_FLOOR}) || ` +
    `(TransactionType:!=\`${sale}\` && ListPrice:>=${RENT_PRICE_FLOOR}))`
  );
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
