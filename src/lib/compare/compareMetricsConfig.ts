/**
 * Config-driven Compare metrics. Each row declares its group, how to read a value
 * (from the listing, the cached AVM estimate, or the live underwrite), how to
 * format it, its winner direction, gating, and persona priority. `resolveRow`
 * turns a metric + the per-column contexts into displayed strings + winners + tags
 * — the one pure seam shared by the desktop table and the mobile card stack.
 */
import type { ListingDocument } from "@/lib/typesense/client";
import type { CompareEstimate } from "@/lib/property/getCompareData";
import type { UnderwritingResult } from "@/lib/underwriting/computeUnderwriting";
import type { PersonaType } from "@/lib/personas/personaConfig";
import { formatPrice } from "@/lib/utils";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { winnerIndices, bestValue, type WinnerDirection } from "./winner";
import { rowIsIdentical } from "./diff";
import { capRateOrNull } from "@/lib/metrics/sanityBand";
import { term } from "@/lib/glossary/terms";

export type CompareGroupId =
  | "valuationDeal"
  | "cashflowCarry"
  | "distressTiming"
  | "suiteDensity"
  | "structural";

/** Visual treatment; winner/diff logic is uniform regardless of kind. */
export type CellKind = "numeric" | "text" | "dealScore" | "estValue" | "discount";

export interface MetricContext {
  listing: ListingDocument;
  estimate?: CompareEstimate;
  underwriting?: UnderwritingResult;
  isAuthed: boolean;
}

export interface CompareMetric {
  key: string;
  label: string;
  group: CompareGroupId;
  cellKind: CellKind;
  /** Numeric value (drives winner + default formatting); null when absent. */
  get?: (ctx: MetricContext) => number | null;
  /** Text value (for cellKind "text"); mutually exclusive with get. */
  getText?: (ctx: MetricContext) => string | null;
  /** Numeric → display string. Defaults to String(v). */
  format?: (v: number) => string;
  winner?: WinnerDirection;
  /** Show each non-winning column's gap to the best (e.g. "+$80k"). */
  magnitude?: boolean;
  /** Gated rows render LockedCell for anonymous users. */
  gated?: boolean;
  /** Never hidden by the diff toggle (e.g. mandatory Brokerage display). */
  alwaysShow?: boolean;
  /** Small tag appended to each populated cell (e.g. "est"). */
  tag?: (ctx: MetricContext) => string | null;
}

// ── Group metadata ────────────────────────────────────────────────────────────
export const GROUP_ORDER: CompareGroupId[] = [
  "valuationDeal",
  "cashflowCarry",
  "distressTiming",
  "suiteDensity",
  "structural",
];

export const GROUP_LABELS: Record<CompareGroupId, string> = {
  valuationDeal: "Valuation & Deal",
  cashflowCarry: "Cashflow & Carry",
  distressTiming: "Distress & Timing",
  suiteDensity: "Suite & Density",
  structural: "Structural",
};

/** The group each persona lens floats to the top (and auto-expands). */
export const LENS_PRIORITY_GROUP: Record<PersonaType, CompareGroupId> = {
  smart: "valuationDeal",
  cashflow: "cashflowCarry",
  flippers: "distressTiming",
  builders: "suiteDensity",
};

export function lensGroupOrder(lens: PersonaType): CompareGroupId[] {
  const p = LENS_PRIORITY_GROUP[lens];
  return [p, ...GROUP_ORDER.filter((g) => g !== p)];
}

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtMoney = (v: number) => `$${Math.round(v).toLocaleString()}`;
const fmtPct1 = (v: number) => `${v.toFixed(1)}%`;
const fmtPerMo = (v: number) => `${formatPrice(Math.round(v))}/mo`;
const fmtSignedPerMo = (v: number) =>
  `${v >= 0 ? "+" : "−"}${formatPrice(Math.abs(Math.round(v)))}/mo`;
const fmtInt = (v: number) => `${v}`;
const fmtDays = (v: number) => `${v} days`;

// ── Derived getters ───────────────────────────────────────────────────────────
const domOf = (l: ListingDocument): number | null =>
  l.TrueDom ?? l.calculatedDOM ?? l.DaysOnMarket ?? null;

const priceDropPct = (l: ListingDocument): number | null => {
  if (!l.OriginalListPrice || !l.ListPrice || l.OriginalListPrice <= l.ListPrice) return null;
  return Math.round(((l.OriginalListPrice - l.ListPrice) / l.OriginalListPrice) * 100);
};

const discountPctOf = (ctx: MetricContext): number | null => {
  const est = ctx.estimate;
  if (!est?.estimatedValue || est.estimatedValue <= 0 || !ctx.listing.ListPrice) return null;
  return ((est.estimatedValue - ctx.listing.ListPrice) / est.estimatedValue) * 100;
};

const ppsfOf = (ctx: MetricContext): number | null => {
  const { estimate: est, listing: l } = ctx;
  if (est?.ppsf && est.ppsf > 0) return est.ppsf;
  return l.BuildingAreaTotal && l.BuildingAreaTotal > 0 ? l.ListPrice / l.BuildingAreaTotal : null;
};

const suiteText = (l: ListingDocument): string =>
  l.SuiteStatus === "EXISTING_SUITE"
    ? "Income suite"
    : l.SuiteStatus === "POTENTIAL_CANDIDATE" || l.hasSecondarySuitePotential
    ? "Suite potential"
    : "None";

const multiUnitText = (l: ListingDocument): string => {
  switch (l.multi_unit_status) {
    case "EXISTING_MULTI_UNIT": return "Existing multi-unit";
    case "PRIME_CANDIDATE": return "Prime candidate";
    case "MARGINAL_CANDIDATE": return "Marginal";
    case "NOT_VIABLE": return "Not viable";
    default: return "—";
  }
};

// ── The metric table ──────────────────────────────────────────────────────────
export const COMPARE_METRICS: CompareMetric[] = [
  // Valuation & Deal
  { key: "dealScore", label: "Deal Score", group: "valuationDeal", cellKind: "dealScore",
    get: (c) => dealScoreFromDocument(c.listing, c.estimate?.estimatedValue && c.estimate.confidence
      ? { estimatedValue: c.estimate.estimatedValue, confidence: c.estimate.confidence } : null).score,
    winner: "high", gated: true },
  { key: "estValue", label: "Est. Value", group: "valuationDeal", cellKind: "estValue",
    get: (c) => c.estimate?.estimatedValue ?? null, format: formatPrice, winner: null, gated: true },
  { key: "vsEstimate", label: "vs Estimate", group: "valuationDeal", cellKind: "discount",
    get: discountPctOf, format: (v) => `${Math.abs(v).toFixed(1)}% ${v >= 0 ? "under" : "over"}`,
    winner: "high", gated: true },
  { key: "listPrice", label: "List Price", group: "valuationDeal", cellKind: "numeric",
    get: (c) => c.listing.ListPrice ?? null, format: formatPrice, winner: "low", magnitude: true },
  { key: "ppsf", label: "Price / Sqft", group: "valuationDeal", cellKind: "numeric",
    get: ppsfOf, format: fmtMoney, winner: "low", magnitude: true },

  // Cashflow & Carry (recomputed live — NOT gated)
  { key: "capRateUw", label: "Cap Rate", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.underwriting?.capRatePct ?? null, format: fmtPct1, winner: "high",
    tag: () => "est" },
  { key: "capRateVA", label: "Est. Cap Rate", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => capRateOrNull(c.listing.cap_rate_est), format: fmtPct1, winner: "high",
    tag: () => "est" },
  { key: "cashflow", label: "Monthly Cashflow", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.underwriting?.monthlyCashflow ?? null, format: fmtSignedPerMo, winner: "high",
    tag: () => "est" },
  { key: "carry", label: term("carryCost").name, group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.underwriting?.monthlyCarry ?? null, format: fmtPerMo, winner: "low" },
  { key: "taxes", label: "Annual Taxes", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.listing.TaxAnnualAmount ?? null, format: formatPrice, winner: "low" },
  { key: "fees", label: "Monthly Fees", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.listing.AssociationFee ?? null, format: formatPrice, winner: "low" },

  // Distress & Timing
  { key: "trueDom", label: "True DOM", group: "distressTiming", cellKind: "numeric",
    get: (c) => domOf(c.listing), format: fmtDays, winner: "high" },
  { key: "priceDrop", label: "Price Drop", group: "distressTiming", cellKind: "numeric",
    get: (c) => priceDropPct(c.listing), format: (v) => `${v}%`, winner: "high" },
  { key: "stale", label: "Stale", group: "distressTiming", cellKind: "text", gated: true,
    getText: (c) => (c.listing.IsStale ? "Stale (>90d)" : "Fresh") },

  // Suite & Density
  { key: "suite", label: "Suite", group: "suiteDensity", cellKind: "text",
    getText: (c) => suiteText(c.listing) },
  { key: "suiteScore", label: "Suite Score", group: "suiteDensity", cellKind: "numeric",
    get: (c) => c.listing.SuiteScore ?? null, format: (v) => `${v}/6`, winner: "high" },
  { key: "multiUnit", label: "Multi-Unit", group: "suiteDensity", cellKind: "text",
    getText: (c) => multiUnitText(c.listing) },
  { key: "surplusParking", label: "Surplus Parking", group: "suiteDensity", cellKind: "numeric",
    get: (c) => c.listing.surplus_parking_count ?? null, format: fmtInt, winner: "high" },
  { key: "densityReady", label: "Density Ready", group: "suiteDensity", cellKind: "text",
    getText: (c) => (c.listing.is_density_ready ? "Yes" : "No") },

  // Structural
  { key: "type", label: "Type", group: "structural", cellKind: "text",
    getText: (c) => c.listing.PropertySubType || c.listing.PropertyType || "—" },
  { key: "beds", label: "Beds", group: "structural", cellKind: "numeric",
    get: (c) => c.listing.BedroomsTotal ?? null, format: fmtInt, winner: null },
  { key: "baths", label: "Baths", group: "structural", cellKind: "numeric",
    get: (c) => c.listing.BathroomsTotalInteger ?? null, format: fmtInt, winner: null },
  { key: "parking", label: "Parking", group: "structural", cellKind: "numeric",
    get: (c) => c.listing.ParkingTotal ?? null, format: fmtInt, winner: null },
  { key: "brokerage", label: "Brokerage", group: "structural", cellKind: "text", alwaysShow: true,
    getText: (c) => c.listing.ListOfficeName || "—" },
];

// ── The pure resolve seam ──────────────────────────────────────────────────────
export interface ResolvedRow {
  values: (number | null)[];
  /** Formatted display strings; null = locked or absent. */
  displayed: (string | null)[];
  locked: boolean[];
  winners: Set<number>;
  bestVal: number | null;
  tags: (string | null)[];
}

/** Turn one metric + the per-column contexts into everything the UI needs. Pure. */
export function resolveRow(metric: CompareMetric, contexts: MetricContext[]): ResolvedRow {
  const locked = contexts.map((c) => Boolean(metric.gated) && !c.isAuthed);

  if (metric.cellKind === "text") {
    const displayed = contexts.map((c, i) => (locked[i] ? null : metric.getText?.(c) ?? null));
    return {
      values: contexts.map(() => null),
      displayed,
      locked,
      winners: new Set(),
      bestVal: null,
      tags: contexts.map(() => null),
    };
  }

  const fmt = metric.format ?? ((v: number) => `${v}`);
  const values = contexts.map((c, i) => (locked[i] ? null : metric.get?.(c) ?? null));
  const displayed = values.map((v) => (v == null ? null : fmt(v)));
  const winners = winnerIndices(values, metric.winner ?? null);
  const bestVal = metric.magnitude ? bestValue(values, metric.winner ?? null) : null;
  const tags = contexts.map((c, i) => (locked[i] || values[i] == null ? null : metric.tag?.(c) ?? null));
  return { values, displayed, locked, winners, bestVal, tags };
}

// ── Core vs extended split ──────────────────────────────────────────────────────
// CORE rows are the original always-visible comparison set, shown flat at the top
// of the page in this classic order. Everything else is an additional metric
// surfaced in the collapsible, lens-ordered groups below.
export const CORE_ORDER: string[] = [
  "dealScore", "estValue", "vsEstimate", "listPrice", "ppsf",
  "beds", "baths", "parking", "trueDom", "priceDrop",
  "capRateUw", "carry", "taxes", "fees", "type", "suite", "brokerage",
];
const CORE_KEYS = new Set(CORE_ORDER);

/** The original always-visible comparison rows, in their classic order. */
export const CORE_METRICS: CompareMetric[] = CORE_ORDER
  .map((k) => COMPARE_METRICS.find((m) => m.key === k))
  .filter((m): m is CompareMetric => Boolean(m));

/** The extra (collapsible) metrics for a group — everything not in the core block. */
export function extendedGroupMetrics(groupId: CompareGroupId): CompareMetric[] {
  return COMPARE_METRICS.filter((m) => m.group === groupId && !CORE_KEYS.has(m.key));
}

export interface VisibleRow {
  metric: CompareMetric;
  resolved: ResolvedRow;
}

/**
 * Resolve a set of metrics against the columns and apply the diff filter: when
 * `diffOnly`, rows where every column renders identically are dropped (except
 * `alwaysShow` rows, e.g. the mandatory Brokerage line). Shared by desktop + mobile.
 */
export function visibleRows(
  metrics: CompareMetric[],
  contexts: MetricContext[],
  diffOnly: boolean
): VisibleRow[] {
  const rows = metrics.map((metric) => ({ metric, resolved: resolveRow(metric, contexts) }));
  return diffOnly
    ? rows.filter(({ metric, resolved }) => metric.alwaysShow || !rowIsIdentical(resolved.displayed))
    : rows;
}
