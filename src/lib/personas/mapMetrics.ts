/**
 * mapMetrics — the selectable "Color By" registry for the map, decoupled from
 * persona. Choosing one drives both the pin hue and the heat columns, and (when
 * the metric is backed by an indexed Typesense field) makes the legend bands
 * click-to-filter.
 *
 * Only fields that are actually POPULATED in the live index are offered (see the
 * field-availability notes in personaConfig.ts): ListPrice, cap_rate_est,
 * TrueDom, TotalPriceDrop, CapitalBurnRateMonthly. Density is a count metric
 * (heatmap aggregation), so it has no field and no band-filter.
 */

import type { ListingDocument } from "@/lib/typesense/client";
import {
  GREEN_RANGE,
  DOM_RANGE,
  DENSITY_RANGE,
  type MapColorConfig,
} from "./personaConfig";
import { capRateOrNull } from "@/lib/metrics/sanityBand";

export interface MapMetricDef extends MapColorConfig {
  id: string;
  label: string;
  /** Indexed Typesense field for the legend band-filter. Omit = not filterable. */
  field?: string;
  /** Compact formatter for legend tick labels. */
  format: (v: number) => string;
  /** Number of legend buckets (≤ range length). */
  bands: number;
  /** Heatmap aggregation: "mean" of the metric, or "count" of listings. */
  heatAggregation?: "mean" | "count";
}

const money = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${Math.round(v)}`;
const pct = (v: number) => `${v.toFixed(1)}%`;
const days = (v: number) => `${Math.round(v)}d`;

export const MAP_METRICS: MapMetricDef[] = [
  {
    id: "price",
    label: "List Price",
    field: "ListPrice",
    metric: (d: ListingDocument) => d.ListPrice ?? 0,
    domain: [200_000, 2_000_000],
    range: DENSITY_RANGE,
    legendLow: "$200K",
    legendHigh: "$2M+",
    format: money,
    bands: 6,
  },
  {
    id: "capRate",
    label: "Cap Rate",
    field: "cap_rate_est",
    // Band-guarded; out-of-band → 0 so the heat/pin consumers' `v > 0` filter drops it.
    metric: (d: ListingDocument) => capRateOrNull(d.cap_rate_est) ?? 0,
    domain: [0, 10],
    range: GREEN_RANGE,
    legendLow: "Low",
    legendHigh: "High",
    format: pct,
    bands: 6,
  },
  {
    id: "trueDom",
    label: "True DOM",
    field: "TrueDom",
    metric: (d: ListingDocument) => d.TrueDom ?? d.calculatedDOM ?? 0,
    domain: [0, 180],
    range: DOM_RANGE,
    legendLow: "Fresh",
    legendHigh: "Stale",
    format: days,
    bands: 6,
  },
  {
    id: "priceDrop",
    label: "Price Drop",
    field: "TotalPriceDrop",
    metric: (d: ListingDocument) => d.TotalPriceDrop ?? 0,
    domain: [0, 100_000],
    range: DOM_RANGE,
    legendLow: "$0",
    legendHigh: "$100K+",
    format: money,
    bands: 6,
  },
  {
    id: "capitalBurn",
    label: "Capital Burn",
    field: "CapitalBurnRateMonthly",
    metric: (d: ListingDocument) => d.CapitalBurnRateMonthly ?? 0,
    domain: [0, 15_000],
    range: DENSITY_RANGE,
    legendLow: "$0",
    legendHigh: "$15K/mo",
    format: money,
    bands: 6,
  },
  {
    id: "density",
    label: "Density",
    metric: () => 1,
    domain: [0, 1],
    range: DENSITY_RANGE,
    legendLow: "Sparse",
    legendHigh: "Dense",
    format: () => "",
    bands: 6,
    heatAggregation: "count",
  },
];

const BY_ID = new Map(MAP_METRICS.map((m) => [m.id, m]));

export function getMapMetric(id: string | null | undefined): MapMetricDef | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/**
 * The [min, max) value range of a legend band. The top band is open-ended so the
 * domain ceiling never excludes the most extreme listings.
 */
export function bandRange(def: MapMetricDef, index: number): { min: number; max: number | null } {
  const [lo, hi] = def.domain;
  const step = (hi - lo) / def.bands;
  const min = lo + step * index;
  const max = index === def.bands - 1 ? null : lo + step * (index + 1);
  return { min, max };
}

/**
 * Typesense filter clause for a selected legend band (null when the metric has
 * no indexed field).
 */
export function bandFilterClause(def: MapMetricDef, index: number): string | null {
  if (!def.field) return null;
  const { min, max } = bandRange(def, index);
  return max === null ? `${def.field}:>=${Math.round(min)}` : `${def.field}:>=${Math.round(min)} && ${def.field}:<${Math.round(max)}`;
}
