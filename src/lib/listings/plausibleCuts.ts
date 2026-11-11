/**
 * plausibleCuts — keep only price cuts that can be real.
 *
 * TotalPriceDrop inherits any typo in the original asking price, so a sort by the largest
 * drop surfaces data errors first (seen 2026-11-10: a $649,990 condo with an "original"
 * ask of $68,999,000). A cut is believable between 2% and 25% of the original price.
 * Keeps the input order.
 */

export const MIN_CUT_SHARE = 0.02;
export const MAX_CUT_SHARE = 0.25;

export interface CutInput {
  ListPrice?: number | null;
  TotalPriceDrop?: number | null;
}

/** True when a cut of `drop` to a current price of `price` is between 2% and 25%. */
export function isPlausibleCut(drop: number | null | undefined, price: number | null | undefined): boolean {
  const d = drop ?? 0;
  const p = price ?? 0;
  if (!(d > 0) || !(p > 0)) return false;
  const share = d / (p + d);
  return share >= MIN_CUT_SHARE && share <= MAX_CUT_SHARE;
}

/**
 * The cut to SHOW for one listing: the drop, or 0 when it is too large to be true.
 *
 * Only the upper bound applies here. A 1% cut is small but real, so it still shows; a
 * cut over 25% of the original ask is a typo or a relist artifact (the $68M "cut" on a
 * $649,990 condo), and every surface that prints a cut must hide it the same way.
 */
export function shownCut(drop: number | null | undefined, price: number | null | undefined): number {
  const d = drop ?? 0;
  const p = price ?? 0;
  if (!(d > 0) || !(p > 0)) return 0;
  return d / (p + d) <= MAX_CUT_SHARE ? d : 0;
}

export function plausibleCuts<T extends CutInput>(docs: T[]): T[] {
  return docs.filter((d) => isPlausibleCut(d.TotalPriceDrop, d.ListPrice));
}
