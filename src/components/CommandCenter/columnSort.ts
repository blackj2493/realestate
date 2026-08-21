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
import type { ColumnType, ColumnDef } from "@/lib/personas/personaConfig";
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";
import { monthlyCashflow } from "@/lib/metrics/liveCashflow";
import type { SharedDealInputs } from "@/lib/finance/dealInputs";
import { getAlphaFlag } from "@/lib/personas/getAlphaFlag";

export type SortDir = "asc" | "desc";

// ============================================================================
// Width-aware column fit (desktop)
// ============================================================================

/** Tailwind width class → px for the fixed analytical columns the personas use. */
const COLUMN_PX: Record<string, number> = {
  "w-16": 64,
  "w-20": 80,
  "w-24": 96,
  "w-32": 128,
};

// Row chrome left of the analytical columns — MUST mirror LedgerRow's markup:
// the px-3 row padding, the w-5 select checkbox, the w-24 thumbnail, and the
// gap-3 flex gap between every adjacent child.
const ROW_PAD = 24; // px-3 (both sides)
const CHECKBOX = 20; // w-5
const THUMB = 96; // w-24
const GAP = 12; // gap-3
/** Floor for the flexing address/price card so it stays legible (audit C4: the
 *  price clipped to "$8…" when columns starved it). Below this we drop a column. */
const ADDRESS_MIN = 160;

const colPx = (col: ColumnDef): number => COLUMN_PX[col.width.trim()] ?? 96;

/**
 * fitLedgerColumns — the subset of persona columns that fit a ledger `width` px wide.
 *
 * The address card always stays (it flexes). Analytical columns are added in
 * config order while the address card keeps ≥ ADDRESS_MIN px; the first that
 * doesn't fit — and everything after it — is dropped. `alphaFlag` is the last
 * (and widest, w-32) column in every persona, so it is the first to go when the
 * panel is narrow — exactly right, since it is the only non-sortable column, so
 * the sortable metric columns survive the squeeze.
 */
export function fitLedgerColumns(columns: ColumnDef[], width: number): ColumnDef[] {
  const address = columns.find((c) => c.type === "address");
  const analytical = columns.filter((c) => c.type !== "address");
  if (width <= 0) return address ? [address] : [...columns];

  const kept: ColumnDef[] = [];
  for (const col of analytical) {
    const candidate = [...kept, col];
    const nChildren = 2 + 1 + candidate.length; // checkbox + thumb + address + analytical
    const gaps = (nChildren - 1) * GAP;
    const fixed = CHECKBOX + THUMB + candidate.reduce((s, c) => s + colPx(c), 0);
    const addressWidth = width - ROW_PAD - fixed - gaps;
    if (addressWidth >= ADDRESS_MIN) kept.push(col);
    else break; // monotonic: every further column only shrinks the address more
  }
  const keptTypes = new Set(kept.map((c) => c.type));
  return columns.filter((c) => c.type === "address" || keptTypes.has(c.type));
}

// ============================================================================
// Adaptive empty-column hiding
// ============================================================================

/**
 * columnHasValue — would this column render a real value for `doc`, or the "—"
 * placeholder? Mirrors the `Cell`/`ColumnValue` renderers in LedgerRow so the
 * two can't drift: a column we call "populated" here is one that shows content
 * there. `isAuthed` matters because the alpha flag's VOW-derived variants
 * (distress / stale / new) collapse to "none" for anonymous users, so a column
 * that is all-flags for signed-in visitors is all-"—" for anon.
 *
 * The always-present ledger scaffolding — address, and the True DOM / Carry Cost
 * columns, which always render a figure (a gated lock or "0d"; a computed carry
 * estimate) rather than "—" — reports `true` unconditionally, so the general
 * empty-column rule below can never strip a core column.
 */
export function columnHasValue(doc: ListingDocument, type: ColumnType, isAuthed: boolean): boolean {
  switch (type) {
    case "address":
    case "trueDom":
    case "carryCost":
      return true;
    case "capRate":
    case "cashflow":
      // Cashflow is derived from the cap rate, so the two are present together.
      return capRateOrNull(doc.cap_rate_est) != null;
    case "yield":
      return grossYieldOrNull(doc.gross_yield_est) != null;
    case "priceDrop":
      return Boolean(doc.TotalPriceDrop);
    case "suite":
      return doc.SuiteStatus === "EXISTING_SUITE" || doc.SuiteStatus === "POTENTIAL_CANDIDATE";
    case "lotDims":
      return (doc.LotWidth ?? doc.lot_width_ft) != null;
    case "zoning":
      return Boolean(doc.zoning_designation);
    case "density":
      return Boolean(doc.is_density_ready);
    case "alphaFlag":
      return getAlphaFlag(doc, isAuthed).variant !== "none";
    default:
      return false;
  }
}

/**
 * dropEmptyColumns — hide any column that NO row in the current result set can
 * populate, so an all-"—" column (most commonly Alpha Flag on the homebuyer lens
 * or for anon) disappears instead of shipping a dash placeholder column.
 *
 * A general rule ("drop columns with zero populated cells"), not an Alpha-Flag
 * special-case: `columnHasValue` reports the always-rendered scaffolding
 * (address / True DOM / Carry Cost) as populated unconditionally, so the core
 * columns are never at risk. The address column is also pinned explicitly, which
 * keeps it (and therefore a non-empty grid) when `docs` is empty during loading.
 */
export function dropEmptyColumns(columns: ColumnDef[], docs: ListingDocument[], isAuthed: boolean): ColumnDef[] {
  if (docs.length === 0) return [...columns]; // nothing loaded yet — keep the persona's full set
  return columns.filter(
    (col) => col.type === "address" || docs.some((doc) => columnHasValue(doc, col.type, isAuthed))
  );
}

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
  "cashflow",
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
/**
 * `financing` is required only by "cashflow", which is not a property of the property
 * — it depends on the reader's down payment and rate. Passed explicitly rather than
 * read from the store, so the caller's useMemo can depend on it and actually re-sort
 * when the reader moves a slider.
 */
export function columnSortValue(
  doc: ListingDocument,
  type: ColumnType,
  financing?: SharedDealInputs
): number | string | null {
  switch (type) {
    case "address":
      return doc.UnparsedAddress ?? doc.City ?? "";
    case "trueDom":
      return doc.TrueDom ?? doc.calculatedDOM ?? doc.DaysOnMarket ?? null;
    case "capRate":
      return capRateOrNull(doc.cap_rate_est);
    case "yield":
      return grossYieldOrNull(doc.gross_yield_est);
    case "cashflow":
      return financing ? monthlyCashflow({ listPrice: doc.ListPrice, capRatePct: doc.cap_rate_est }, financing) : null;
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
export function compareByColumn(type: ColumnType, dir: SortDir, financing?: SharedDealInputs) {
  const factor = dir === "asc" ? 1 : -1;
  return (a: ListingDocument, b: ListingDocument): number => {
    const av = columnSortValue(a, type, financing);
    const bv = columnSortValue(b, type, financing);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // a missing → bottom
    if (bv === null) return -1; // b missing → bottom
    if (typeof av === "string" || typeof bv === "string") {
      return factor * String(av).localeCompare(String(bv));
    }
    return factor * (av - bv);
  };
}
