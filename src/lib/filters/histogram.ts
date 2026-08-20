/**
 * Distribution-histogram helpers for the range sliders. Counts come from
 * Typesense via batched range COUNT queries (multi_search — see searchHistogram
 * in the Typesense client), NOT from faceting the numeric field: ListPrice is
 * high-cardinality int32 and the 2026-05-19 RAM policy forbids faceting it.
 */

/** A single histogram bucket. `hi === null` marks the open-ended top band (≥ lo). */
export interface HistogramBand {
  lo: number;
  hi: number | null;
}

/**
 * Split [min, max] into `n` equal bands; the last is open-ended (≥ lo) so values
 * above `max` (e.g. >$3M sales) still land in the top bar instead of vanishing.
 */
export function buildBands(min: number, max: number, n: number): HistogramBand[] {
  if (n <= 0 || max <= min) return [];
  const width = (max - min) / n;
  const bands: HistogramBand[] = [];
  for (let i = 0; i < n; i++) {
    const lo = min + i * width;
    const hi = i === n - 1 ? null : min + (i + 1) * width;
    bands.push({ lo, hi });
  }
  return bands;
}

/** Typesense schema type of a histogram field — decides how bandFilter writes an edge. */
export type HistogramFieldType = "int32" | "float";

/**
 * Numeric fields that are indexed/filterable in Typesense and so can back a
 * histogram, each mapped to its SCHEMA TYPE. Unindexed numerics (e.g.
 * TaxAnnualAmount, index:false) are absent — the hook skips the histogram for
 * those rather than firing a failing query.
 *
 * Keep every type in lockstep with src/lib/typesense/typesenseSchema.ts: an int32
 * field rejects a decimal band edge, so a wrong type here either errors the count
 * query or silently mis-buckets the bars.
 */
export const HISTOGRAM_FIELDS: ReadonlyMap<string, HistogramFieldType> = new Map<
  string,
  HistogramFieldType
>([
  ["ListPrice", "int32"],
  ["LotSqftTotal", "float"],
  ["LotWidth", "float"],
  ["AssociationFee", "float"],
  ["BedroomsTotal", "int32"],
  ["BathroomsTotalInteger", "int32"],
  ["ParkingTotal", "int32"],
  ["surplus_parking_count", "int32"],
  ["ExtrapolatedCapRate", "float"], // legacy — retired from UI controls (spec §9); kept indexed until reindex
  ["cap_rate_est", "float"],
  ["gross_yield_est", "float"],
  ["CapitalBurnRateMonthly", "float"],
  ["MonthlyCarryCost", "float"],
  ["TrueDom", "int32"],
  ["TotalPriceDrop", "int32"],
]);

/**
 * Typesense filter_by fragment counting one band of `field`.
 *
 * Band edges are rarely integers: a 0-12 slider over 20 bands steps by 0.6.
 * Typesense rejects a decimal against an int32 field ("Not an int32"), so an
 * int32 edge snaps UP — the half-open band [lo, hi) holds exactly the integers n
 * with ceil(lo) <= n < ceil(hi), and that is an identity on integer edges, so
 * whole-number sliders keep their old clauses. A float field keeps the real edge,
 * trimmed of binary-float noise (0.6000000000000001 -> 0.6). Both edges of a
 * shared boundary derive from the same expression, so bands still tile with no
 * gap and no overlap.
 *
 * The old code floored BOTH edges. On the cap rate slider that emitted the
 * impossible `cap_rate_est:>=1 && cap_rate_est:<1` for 8 of 20 bands and shifted
 * every survivor a full point off its label.
 */
export function bandFilter(field: string, b: HistogramBand): string {
  const edge = HISTOGRAM_FIELDS.get(field) === "float" ? trimFloat : Math.ceil;
  const lo = `${field}:>=${edge(b.lo)}`;
  return b.hi === null ? lo : `${lo} && ${field}:<${edge(b.hi)}`;
}

/** Drop binary-float noise from a band edge; 4 decimals is far below any slider step. */
function trimFloat(v: number): number {
  return Number(v.toFixed(4));
}

export function supportsHistogram(field: string | undefined): field is string {
  return !!field && HISTOGRAM_FIELDS.has(field);
}

/** Default bar count for a slider histogram (fits the ~224px popover). */
export const HISTOGRAM_BANDS = 20;
