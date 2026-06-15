/**
 * cohortPercentiles — rank a listing's metric against the CURRENT result set.
 *
 * First-principles: a raw number ("cap 5.3%") is noise; its position in the
 * cohort ("P88") is signal. The cohort here is exactly what's on screen — the
 * ≤100 listings the active query returned — so the rank is honest ("vs results")
 * and updates live as filters change. No backend, no aggregates.
 *
 * Values come from `columnSortValue` (the same extractor the ledger cell renders
 * and the column sort uses), so the percentile can never disagree with the
 * number beside it.
 */

import type { ListingDocument } from "@/lib/typesense/client";
import type { ColumnType } from "@/lib/personas/personaConfig";
import { columnSortValue } from "./columnSort";

/** Numeric columns where a "position in the cohort" reading is meaningful. */
export const PERCENTILE_COLUMN_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  "trueDom",
  "capRate",
  "yield",
  "carryCost",
  "priceDrop",
]);

/** Below this many in-cohort values a percentile is too noisy to show. */
export const MIN_COHORT = 10;

/** (columnType, value) → percentile 0–100, or null when not rankable. */
export type CohortRanker = (type: ColumnType, value: number) => number | null;

/** Count of cohort values strictly less than `value` (binary search; arr sorted asc). */
function countBelow(arr: readonly number[], value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Build a ranker over `listings`. Pre-sorts each metric once so per-cell lookups
 * are O(log n). The ranker returns the percentile rank (% of the cohort below the
 * value); null when the cohort is too small or the value isn't finite.
 */
export function makeCohortRanker(listings: readonly ListingDocument[]): CohortRanker {
  const sorted = new Map<ColumnType, number[]>();
  for (const type of PERCENTILE_COLUMN_TYPES) {
    const vals: number[] = [];
    for (const l of listings) {
      const v = columnSortValue(l, type);
      if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    sorted.set(type, vals);
  }

  return (type, value) => {
    const arr = sorted.get(type);
    if (!arr || arr.length < MIN_COHORT || !Number.isFinite(value)) return null;
    return Math.round((countBelow(arr, value) / arr.length) * 100);
  };
}
