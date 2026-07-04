/**
 * PERSONA_CONFIG — single source of truth for the Command Center terminal.
 *
 * Each persona defines its filter controls, the Typesense filter_by string it
 * builds, the ledger columns it shows, and how the map colors listings.
 *
 * IMPORTANT (verified against live Typesense):
 * - `location` is stored as [lat, lng] (Typesense geopoint convention).
 * - These fields are stored-but-UNINDEXED and CANNOT appear in filter_by
 *   (HTTP 400): zoning_designation, multiplex_by_right, TransactionType.
 *   They are fine for display/color only.
 * - isDistressed, hasSecondarySuitePotential, and calculatedDOM ARE indexed
 *   facets (declared in typesenseSchema.ts, live collection altered 2026-06-10
 *   via add-investor-filter-fields.ts — audit HIGH-5). Use filter_by freely.
 * - targetGrossYield is no longer emitted by the transformer (removed 2026-06-10;
 *   its filter clauses went in PR #13). Do not use it.
 * - cap_rate_est / gross_yield_est ARE populated (~47% of for-sale) + indexed +
 *   filterable + sortable — they back the cashflow/smart cap & yield controls.
 *   Sparse by design (rent index suppresses cohorts < N=5); guard every read with
 *   the sanity band (src/lib/metrics/sanityBand.ts). cap_rate_est / gross_yield_est
 *   are PERCENT. The old fake ExtrapolatedCapRate is retired from the UI (spec §9).
 * - Filterable + populated: cap_rate_est, gross_yield_est, CapitalBurnRateMonthly,
 *   MonthlyCarryCost, TrueDom, SuiteStatus, multi_unit_status, is_density_ready,
 *   surplus_parking_count, LotWidth, LotSqftTotal, IsStale, TotalPriceDrop.
 */

import { DollarSign, TrendingUp, Home, Hammer, type LucideIcon } from "lucide-react";
import type { ListingDocument } from "@/lib/typesense/client";
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";
import type { GlossaryKey } from "@/lib/glossary";

export type PersonaType = "smart" | "cashflow" | "flippers" | "builders";

// ============================================================================
// Filter state (flat — each persona reads its relevant subset)
// ============================================================================

export interface TerminalFilterState {
  minCapRate: number; // %
  maxCarryCost: number; // $/mo
  maxCapitalBurn: number; // $/mo
  trueDomMin: number; // days
  trueDomMax: number; // days
  minPriceDrop: number; // $
  minFrontage: number; // ft
  minLotSqft: number; // sqft
  minSurplusParking: number; // spaces
  zoningPotential: boolean; // is_density_ready
  duplexCandidate: boolean; // SuiteStatus / multi_unit_status
  staleOnly: boolean; // IsStale
}

export const defaultTerminalFilters: TerminalFilterState = {
  minCapRate: 0,
  maxCarryCost: 15000,
  maxCapitalBurn: 20000,
  trueDomMin: 0,
  trueDomMax: 365,
  minPriceDrop: 0,
  minFrontage: 0,
  minLotSqft: 0,
  minSurplusParking: 0,
  zoningPotential: false,
  duplexCandidate: false,
  staleOnly: false,
};

type NumericKey =
  | "minCapRate"
  | "maxCarryCost"
  | "maxCapitalBurn"
  | "trueDomMin"
  | "trueDomMax"
  | "minPriceDrop"
  | "minFrontage"
  | "minLotSqft"
  | "minSurplusParking";

type BoolKey = "zoningPotential" | "duplexCandidate" | "staleOnly";

// ============================================================================
// Controls
// ============================================================================

/**
 * Each control carries its own `buildClause` so the Typesense filter for a signal
 * lives with its definition — the query then applies EVERY set investor control
 * (see buildInvestorClause), independent of which persona is active. That's what
 * lets a Cashflow user keep a Flipper's "Price Drop" applied, and what fixes a
 * value set under one persona silently going dormant under another.
 */
export type ControlDef =
  | {
      kind: "slider";
      key: NumericKey;
      label: string;
      short?: string; // concise chip name, e.g. "Cap Rate"
      op?: "≥" | "≤"; // chip threshold direction (default "≥")
      min: number;
      max: number;
      step: number;
      format: (v: number) => string;
      /** Typesense numeric field for the distribution histogram (optional). */
      field?: string;
      /** Glossary term explained via a ⓘ next to the control label (optional). */
      glossaryKey?: GlossaryKey;
      /** Typesense filter_by fragment for the current value, or null when default. */
      buildClause: (f: TerminalFilterState) => string | null;
    }
  | {
      kind: "range";
      minKey: NumericKey;
      maxKey: NumericKey;
      label: string;
      short?: string;
      min: number;
      max: number;
      step: number;
      format: (v: number) => string;
      /** Typesense numeric field for the distribution histogram (optional). */
      field?: string;
      /** Glossary term explained via a ⓘ next to the control label (optional). */
      glossaryKey?: GlossaryKey;
      /** Typesense filter_by fragment for the current value, or null when default. */
      buildClause: (f: TerminalFilterState) => string | null;
    }
  | {
      kind: "toggle";
      key: BoolKey;
      label: string;
      short?: string;
      glossaryKey?: GlossaryKey;
      /** Typesense filter_by fragment for the current value, or null when default. */
      buildClause: (f: TerminalFilterState) => string | null;
    };

const fmtPct = (v: number) => `${v}%`;
const fmtMoney = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v}`;
const fmtDays = (v: number) => `${v}d`;
const fmtFt = (v: number) => `${v}′`;
const fmtNum = (v: number) => `${v}`;

// ============================================================================
// Ledger columns
// ============================================================================

export type ColumnType =
  | "address"
  | "trueDom"
  | "capRate"
  | "yield"
  | "carryCost"
  | "priceDrop"
  | "suite"
  | "lotDims"
  | "zoning"
  | "density"
  | "alphaFlag";

export interface ColumnDef {
  type: ColumnType;
  header: string;
  width: string; // tailwind width class
  align: "left" | "right" | "center";
}

// ============================================================================
// Map color
// ============================================================================

export interface MapColorConfig {
  metric: (d: ListingDocument) => number;
  domain: [number, number];
  range: [number, number, number][];
  legendLow: string;
  legendHigh: string;
  /** true → values are ~47% populated; the map must treat 0 as "no estimate", not "low". */
  sparse?: boolean;
  /** Human-readable metric name for the heatmap hover tooltip (e.g. "Cap Rate"). */
  label?: string;
  /** Units-aware formatter for a metric value in the heatmap hover tooltip. */
  format?: (v: number) => string;
}

// Low (muted) -> High (bright) green ramp — yield / cap rate
export const GREEN_RANGE: [number, number, number][] = [
  [13, 42, 33],
  [6, 78, 59],
  [4, 120, 87],
  [16, 185, 129],
  [52, 211, 153],
  [134, 239, 172],
];

// Fresh (blue) -> Stale (red) — True DOM
export const DOM_RANGE: [number, number, number][] = [
  [59, 130, 246],
  [6, 182, 212],
  [34, 197, 94],
  [250, 204, 21],
  [249, 115, 22],
  [239, 68, 68],
];

// Low -> High density (slate -> cyan)
export const DENSITY_RANGE: [number, number, number][] = [
  [51, 65, 85],
  [14, 116, 144],
  [8, 145, 178],
  [6, 182, 212],
  [34, 211, 238],
  [103, 232, 249],
];

// "Alpha glow" ramp for the 3D heat columns — deep teal (low) → cyan → royal
// blue (high). Applied to the heatmap regardless of persona so the columns read
// as luminous density rather than the per-persona metric hue.
export const ALPHA_GLOW_RANGE: [number, number, number][] = [
  [8, 51, 68],
  [12, 110, 138],
  [13, 165, 196],
  [34, 211, 238],
  [56, 130, 246],
  [99, 110, 247],
];

// ============================================================================
// Persona definitions
// ============================================================================

export type MapMode = "listings" | "heatmap" | "3d";

export interface PersonaDef {
  id: PersonaType;
  label: string;
  /** Concise label for narrow viewports (mobile lens pills). Optional/additive. */
  short?: string;
  icon: LucideIcon;
  /** The curated signals this persona pins by default. A subset of INVESTOR_CONTROLS;
   *  every other signal stays reachable via the "+ Add filter" palette. */
  controls: ControlDef[];
  sortBy?: string;
  columns: ColumnDef[];
  mapColor: MapColorConfig;
  // Which map view this persona drops into by default. Identification-focused
  // personas (smart/flippers) start in Listings; spatial-analysis personas
  // (cashflow/builders) start in Heatmap. Always user-toggleable at runtime.
  defaultMapMode: MapMode;
}

const join = (parts: string[]) => parts.filter(Boolean).join(" && ");

// ============================================================================
// Investor control catalog — the single, deduped source for every investor
// signal. Each persona PINS a curated subset (its `controls`), but the catalog
// is what the "+ Add filter" palette offers and what the query applies, so any
// signal is reachable and active regardless of the active persona.
// ============================================================================

/** Cap rate (cap_rate_est). One canonical control — previously Smart exposed the
 *  same field under the "Target Gross Yield" label, which read as a second metric. */
const C_CAP_RATE: ControlDef = {
  kind: "slider", key: "minCapRate", label: "Min Cap Rate", short: "Cap Rate", op: "≥",
  min: 0, max: 12, step: 0.5, format: fmtPct, field: "cap_rate_est", glossaryKey: "capRate",
  buildClause: (f) => (f.minCapRate > 0 ? `cap_rate_est:>=${Math.max(f.minCapRate, 1)} && cap_rate_est:<=15` : null),
};
const C_TRUE_DOM: ControlDef = {
  kind: "range", minKey: "trueDomMin", maxKey: "trueDomMax", label: "True DOM", short: "True DOM",
  min: 0, max: 365, step: 5, format: fmtDays, field: "TrueDom", glossaryKey: "dom",
  buildClause: (f) =>
    join([f.trueDomMin > 0 ? `TrueDom:>=${f.trueDomMin}` : "", f.trueDomMax < 365 ? `TrueDom:<=${f.trueDomMax}` : ""]) || null,
};
const C_CARRY_COST: ControlDef = {
  kind: "slider", key: "maxCarryCost", label: "Max Carry Cost (CAD/Mo)", short: "Carry Cost", op: "≤",
  min: 0, max: 15000, step: 250, format: fmtMoney, field: "MonthlyCarryCost", glossaryKey: "carry",
  buildClause: (f) => (f.maxCarryCost < 15000 ? `MonthlyCarryCost:<=${f.maxCarryCost}` : null),
};
const C_CAPITAL_BURN: ControlDef = {
  kind: "slider", key: "maxCapitalBurn", label: "Max Capital Burn (CAD/Mo)", short: "Capital Burn", op: "≤",
  min: 0, max: 20000, step: 250, format: fmtMoney, field: "CapitalBurnRateMonthly",
  buildClause: (f) => (f.maxCapitalBurn < 20000 ? `CapitalBurnRateMonthly:<=${f.maxCapitalBurn}` : null),
};
const C_SURPLUS_PARKING: ControlDef = {
  kind: "slider", key: "minSurplusParking", label: "Min Surplus Parking", short: "Surplus Parking", op: "≥",
  min: 0, max: 6, step: 1, format: fmtNum, field: "surplus_parking_count",
  buildClause: (f) => (f.minSurplusParking > 0 ? `surplus_parking_count:>=${f.minSurplusParking}` : null),
};
const C_PRICE_DROP: ControlDef = {
  kind: "slider", key: "minPriceDrop", label: "Min Price Drop", short: "Price Drop", op: "≥",
  min: 0, max: 200000, step: 5000, format: fmtMoney, field: "TotalPriceDrop", glossaryKey: "priceDrop",
  buildClause: (f) => (f.minPriceDrop > 0 ? `TotalPriceDrop:>=${f.minPriceDrop}` : null),
};
const C_FRONTAGE: ControlDef = {
  kind: "slider", key: "minFrontage", label: "Min Frontage", short: "Frontage", op: "≥",
  min: 0, max: 200, step: 5, format: fmtFt, field: "LotWidth",
  buildClause: (f) => (f.minFrontage > 0 ? `LotWidth:>=${f.minFrontage}` : null),
};
const C_LOT_SQFT: ControlDef = {
  kind: "slider", key: "minLotSqft", label: "Min Lot (sqft)", short: "Lot Size", op: "≥",
  min: 0, max: 20000, step: 500, format: fmtNum, field: "LotSqftTotal",
  buildClause: (f) => (f.minLotSqft > 0 ? `LotSqftTotal:>=${f.minLotSqft}` : null),
};
// Density / zoning potential (is_density_ready). FIX: this toggle was mislabeled
// "Surplus Parking" in the Smart + Builders personas while it actually filters
// density-readiness (and sat next to a real Surplus Parking slider in Builders).
const C_DENSITY: ControlDef = {
  kind: "toggle", key: "zoningPotential", label: "Zoning / Density Ready", short: "Density",
  buildClause: (f) => (f.zoningPotential ? `is_density_ready:=true` : null),
};
const C_SUITE_DUPLEX: ControlDef = {
  kind: "toggle", key: "duplexCandidate", label: "Suite / Duplex", short: "Suite / Duplex",
  buildClause: (f) =>
    f.duplexCandidate
      ? `(SuiteStatus:=POTENTIAL_CANDIDATE || SuiteStatus:=EXISTING_SUITE || multi_unit_status:=PRIME_CANDIDATE)`
      : null,
};
const C_STALE: ControlDef = {
  kind: "toggle", key: "staleOnly", label: "Stale Only", short: "Stale Only",
  buildClause: (f) => (f.staleOnly ? `IsStale:=true` : null),
};

/** Every investor signal, deduped. Persona `controls` reference these by object. */
export const INVESTOR_CONTROLS: ControlDef[] = [
  C_CAP_RATE,
  C_TRUE_DOM,
  C_CARRY_COST,
  C_CAPITAL_BURN,
  C_SURPLUS_PARKING,
  C_PRICE_DROP,
  C_FRONTAGE,
  C_LOT_SQFT,
  C_DENSITY,
  C_SUITE_DUPLEX,
  C_STALE,
];

/**
 * The investor filter_by fragment for the CURRENT terminal state — the union of
 * every set control, persona-independent. Replaces the old per-persona
 * buildFilterString so a signal set under any persona keeps applying everywhere
 * (residential-sale gating still happens in buildTerminalCoreClauses).
 */
export function buildInvestorClause(f: TerminalFilterState): string {
  return INVESTOR_CONTROLS.map((c) => c.buildClause(f)).filter(Boolean).join(" && ");
}

export const PERSONA_CONFIG: Record<PersonaType, PersonaDef> = {
  // ----- Smart Homebuyer (DEFAULT = mockup) -----
  smart: {
    id: "smart",
    label: "Smart Homebuyer",
    short: "Homebuyer",
    icon: Home,
    // Pinned signals for the homebuyer-investor lens; the rest stay one tap away
    // in "+ Add filter". (Was a "Target Gross Yield" control that actually filtered
    // cap rate — now the single Cap Rate control; the "Surplus Parking" toggle that
    // actually filtered density is now the correctly-named Density control.)
    controls: [C_CAP_RATE, C_TRUE_DOM, C_CAPITAL_BURN, C_DENSITY, C_SUITE_DUPLEX],
    columns: [
      { type: "address", header: "Address", width: "flex-1 min-w-0", align: "left" },
      { type: "trueDom", header: "True DOM", width: "w-16", align: "right" },
      { type: "capRate", header: "Cap Rate", width: "w-16", align: "right" },
      { type: "carryCost", header: "Carry Cost", width: "w-24", align: "right" },
      { type: "alphaFlag", header: "Alpha Flag", width: "w-32", align: "right" },
    ],
    mapColor: { metric: (d) => grossYieldOrNull(d.gross_yield_est) ?? 0, domain: [2, 8], range: GREEN_RANGE, legendLow: "Low Yield", legendHigh: "High Yield", sparse: true, label: "Gross Yield", format: (v) => `${v.toFixed(1)}%` },
    defaultMapMode: "listings",
  },

  // ----- Cashflow Investor -----
  cashflow: {
    id: "cashflow",
    label: "Cashflow Investor",
    short: "Cashflow",
    icon: DollarSign,
    controls: [C_CAP_RATE, C_CARRY_COST, C_SURPLUS_PARKING, C_SUITE_DUPLEX],
    sortBy: "cap_rate_est",
    columns: [
      { type: "address", header: "Address", width: "flex-1 min-w-0", align: "left" },
      { type: "capRate", header: "Cap Rate", width: "w-16", align: "right" },
      { type: "yield", header: "Yield", width: "w-16", align: "right" },
      { type: "carryCost", header: "Carry Cost", width: "w-24", align: "right" },
      { type: "alphaFlag", header: "Alpha Flag", width: "w-32", align: "right" },
    ],
    mapColor: { metric: (d) => capRateOrNull(d.cap_rate_est) ?? 0, domain: [0, 10], range: GREEN_RANGE, legendLow: "Low Cap", legendHigh: "High Cap", sparse: true, label: "Cap Rate", format: (v) => `${v.toFixed(1)}%` },
    defaultMapMode: "heatmap",
  },

  // ----- Flippers & Deal Hunters -----
  flippers: {
    id: "flippers",
    label: "Flippers & Deal Hunters",
    short: "Flipper",
    icon: TrendingUp,
    controls: [C_TRUE_DOM, C_PRICE_DROP, C_CAPITAL_BURN, C_STALE],
    sortBy: "TrueDom",
    columns: [
      { type: "address", header: "Address", width: "flex-1 min-w-0", align: "left" },
      { type: "trueDom", header: "True DOM", width: "w-16", align: "right" },
      { type: "priceDrop", header: "Price Drop", width: "w-20", align: "right" },
      { type: "carryCost", header: "Carry Cost", width: "w-24", align: "right" },
      { type: "alphaFlag", header: "Alpha Flag", width: "w-32", align: "right" },
    ],
    mapColor: { metric: (d) => d.TrueDom ?? d.calculatedDOM ?? 0, domain: [0, 180], range: DOM_RANGE, legendLow: "Fresh", legendHigh: "Stale", label: "True DOM", format: (v) => `${Math.round(v)}d` },
    defaultMapMode: "listings",
  },

  // ----- Builders & Developers -----
  builders: {
    id: "builders",
    label: "Builders & Developers",
    short: "Builder",
    icon: Hammer,
    controls: [C_FRONTAGE, C_LOT_SQFT, C_SURPLUS_PARKING, C_DENSITY],
    sortBy: "LotWidth",
    columns: [
      { type: "address", header: "Address", width: "flex-1 min-w-0", align: "left" },
      { type: "lotDims", header: "Lot", width: "w-24", align: "right" },
      // Zoning is NOT shown inline: it's municipal open-data (not MLS), so it lives in a
      // dedicated attributed surface (property-detail Zoning card + map overlay) with source
      // + by-law + "not a legal survey" disclaimer — never blended into these MLS columns.
      { type: "density", header: "Surplus", width: "w-16", align: "center" },
      { type: "alphaFlag", header: "Alpha Flag", width: "w-32", align: "right" },
    ],
    mapColor: { metric: (d) => d.surplus_parking_count ?? 0, domain: [0, 6], range: DENSITY_RANGE, legendLow: "Fewer", legendHigh: "More", label: "Surplus Parking", format: (v) => v.toFixed(1) },
    defaultMapMode: "heatmap",
  },
};

export const PERSONA_LIST: PersonaDef[] = [
  PERSONA_CONFIG.smart,
  PERSONA_CONFIG.cashflow,
  PERSONA_CONFIG.flippers,
  PERSONA_CONFIG.builders,
];
