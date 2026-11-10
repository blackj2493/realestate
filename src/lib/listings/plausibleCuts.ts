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

export function plausibleCuts<T extends CutInput>(docs: T[]): T[] {
  return docs.filter((d) => {
    const drop = d.TotalPriceDrop ?? 0;
    const price = d.ListPrice ?? 0;
    if (drop <= 0 || price <= 0) return false;
    const share = drop / (price + drop);
    return share >= MIN_CUT_SHARE && share <= MAX_CUT_SHARE;
  });
}
