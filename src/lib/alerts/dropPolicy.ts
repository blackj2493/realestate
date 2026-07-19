/**
 * Price-drop alert policy — pure (§4: deterministic).
 *
 * A cut only alerts when it's meaningful: at least MIN_DROP_ABS dollars, OR at least
 * MIN_DROP_PCT of the baseline. Sub-threshold cuts do NOT refresh the baseline — the
 * baseline is a HIGH-WATER mark since the last alert (reset upward on any rise), so a
 * slow bleed of small cuts accumulates until the total clears the threshold instead of
 * being silently absorbed $1,000 at a time.
 */

/** Absolute floor: any cut of $5k+ is worth an email regardless of price tier. */
export const MIN_DROP_ABS = 5_000;
/** Relative floor: 1% of the baseline catches meaningful cuts on cheaper homes. */
export const MIN_DROP_PCT = 0.01;

/** Whether old→new qualifies as an alertable price drop. */
export function qualifiesAsDrop(oldPrice: number, newPrice: number): boolean {
  if (!(oldPrice > 0) || !(newPrice > 0) || newPrice >= oldPrice) return false;
  const cut = oldPrice - newPrice;
  return cut >= MIN_DROP_ABS || cut >= oldPrice * MIN_DROP_PCT;
}
