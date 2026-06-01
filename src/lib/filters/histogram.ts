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

/** Typesense filter_by fragment counting one band of `field`. */
export function bandFilter(field: string, b: HistogramBand): string {
  const lo = `${field}:>=${Math.floor(b.lo)}`;
  return b.hi === null ? lo : `${lo} && ${field}:<${Math.floor(b.hi)}`;
}

/**
 * Numeric fields that are indexed/filterable in Typesense and so can back a
 * histogram. Unindexed numerics (e.g. AssociationFee, index:false) are absent —
 * the hook skips the histogram for those rather than firing a failing query.
 */
export const HISTOGRAM_FIELDS: ReadonlySet<string> = new Set([
  "ListPrice",
  "LotSqftTotal",
  "LotWidth",
  "BedroomsTotal",
  "BathroomsTotalInteger",
  "ParkingTotal",
  "surplus_parking_count",
  "ExtrapolatedCapRate",
  "CapitalBurnRateMonthly",
  "MonthlyCarryCost",
  "TrueDom",
  "TotalPriceDrop",
  // NB: gross_yield_est / cap_rate_est are EMPTY in the live index — intentionally
  // excluded so no slider fires 20 all-zero count queries. Use ExtrapolatedCapRate.
]);

export function supportsHistogram(field: string | undefined): field is string {
  return !!field && HISTOGRAM_FIELDS.has(field);
}

/** Default bar count for a slider histogram (fits the ~224px popover). */
export const HISTOGRAM_BANDS = 20;
