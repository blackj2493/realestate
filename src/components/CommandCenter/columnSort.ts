/**
 * columnSort — client-side sort values + comparator for the ledger columns.
 *
 * Single source of truth for how each persona column maps to a comparable
 * value. The extraction here mirrors what the `Cell` renderer in LedgerRow
 * displays, so sorting always matches what the user sees. Computed columns
 * (Carry Cost, Lot) have no single Typesense field, which is why this is a
 * client-side concern rather than a Typesense `sort_by`.
 */

import type { ListingDocument } from "@/lib/typesense/client";
import type { ColumnType } from "@/lib/personas/personaConfig";
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";

export type SortDir = "asc" | "desc";

/** Monthly carrying cost — explicit field, else a deterministic 80% LTV @ 7% / 30yr estimate. */
export function carryFor(p: ListingDocument): number {
  if (p.MonthlyCarryCost) return Math.round(p.MonthlyCarryCost);
  const principal = (p.ListPrice || 0) * 0.8;
  const r = 0.07 / 12;
  const n = 360;
  const mortgage = principal ? (principal * (r * (1 + r) ** n)) / ((1 + r) ** n - 1) : 0;
  return Math.round(mortgage + (p.TaxAnnualAmount || 0) / 12 + (p.AssociationFee || 0));
}

/** Columns where a click-to-sort is meaningful. `alphaFlag` (composite badge) is intentionally excluded. */
export const SORTABLE_COLUMN_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  "address",
  "trueDom",
  "capRate",
  "yield",
  "carryCost",
  "priceDrop",
  "suite",
  "lotDims",
  "zoning",
  "density",
]);

/** First-click direction per column: numerics lead with highest-first, text with A→Z. */
export const DEFAULT_SORT_DIR: Partial<Record<ColumnType, SortDir>> = {
  address: "asc",
  zoning: "asc",
};

/**
 * The comparable value for a column. Returns `null` for missing data so it can
 * be forced to the bottom regardless of direction.
 */
export function columnSortValue(doc: ListingDocument, type: ColumnType): number | string | null {
  switch (type) {
    case "address":
      return doc.UnparsedAddress ?? doc.City ?? "";
    case "trueDom":
      return doc.TrueDom ?? doc.calculatedDOM ?? doc.DaysOnMarket ?? null;
    case "capRate":
      return capRateOrNull(doc.cap_rate_est);
    case "yield":
      return grossYieldOrNull(doc.gross_yield_est);
    case "carryCost":
      return carryFor(doc);
    case "priceDrop":
      return doc.TotalPriceDrop ?? null;
    case "suite":
      return doc.SuiteStatus === "EXISTING_SUITE" ? 2 : doc.SuiteStatus === "POTENTIAL_CANDIDATE" ? 1 : 0;
    case "lotDims":
      return doc.LotWidth ?? doc.lot_width_ft ?? null;
    case "zoning":
      return doc.zoning_designation || "";
    case "density":
      return doc.is_density_ready ? 1 : 0;
    default:
      return null;
  }
}

/**
 * Comparator factory for a column + direction. `null` values always sink to the
 * bottom; strings use locale compare, numbers subtract.
 */
export function compareByColumn(type: ColumnType, dir: SortDir) {
  const factor = dir === "asc" ? 1 : -1;
  return (a: ListingDocument, b: ListingDocument): number => {
    const av = columnSortValue(a, type);
    const bv = columnSortValue(b, type);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // a missing → bottom
    if (bv === null) return -1; // b missing → bottom
    if (typeof av === "string" || typeof bv === "string") {
      return factor * String(av).localeCompare(String(bv));
    }
    return factor * (av - bv);
  };
}
