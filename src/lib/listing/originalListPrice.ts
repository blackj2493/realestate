/**
 * Sanity guard for OriginalListPrice / original_list_price.
 *
 * The PropTx feed occasionally ships this field scaled by 1000: 6 Oaken Gate Way carries an
 * original ask of $949,000,000 against a $949,000 list. Rare — 20 of 73,529 sold documents
 * that have the field (0.027%), 43 rows in raw_vow_sold above $100M — but nothing bounded it
 * on the way in OR on the way out, so a single bad row renders as:
 *
 *   • "-99% PRICE DROP" on the terminal card (AlphaBadge)
 *   • "99.9% under ask" on the listing card (soldVsAsk)
 *   • "Last list price: $1,875,000,000" on the address page
 *   • an original-price line off the top of the DOM timeline chart
 *   • a maxed-out TERMS price-cut component in the Deal Score, on a cut that never happened
 *
 * The inverse also occurs (67 rows with an original under $10k against a six-figure list),
 * usually a lease row whose monthly rent landed in the wrong field.
 *
 * WHY A RATIO, NOT AN ABSOLUTE CEILING: a $100M cap would still pass a $5,500/mo lease
 * scaled to $5,500,000. The corruption is always a SCALE error relative to the live ask, so
 * the ask is the right yardstick.
 *
 * MAX_RATIO is deliberately loose. Real reductions cluster at 1.0–1.5x; across 40,000 rows
 * only 10 sat between 1.5x and 5x, and every observed corruption was >= 999x. So 5x clears
 * genuine data by a wide margin and still catches every real case. Better to let one freak
 * reduction through than to silently erase a true price history.
 */

/** An original ask more than this multiple of the live ask is a feed scale error, not a cut. */
export const ORIGINAL_LIST_MAX_RATIO = 5;

/** Below this multiple the "original" is too small to be the same listing's first ask. */
export const ORIGINAL_LIST_MIN_RATIO = 0.2;

/**
 * The original list price, or null when it cannot be true for this listing.
 *
 * Pass the live ask as `listPrice`. With no usable ask there is nothing to sanity-check
 * against, so the value is rejected rather than trusted — this field only ever exists to be
 * compared with the current price.
 */
export function sanitizeOriginalListPrice(
  original: number | null | undefined,
  listPrice: number | null | undefined,
): number | null {
  const o = typeof original === "number" ? original : NaN;
  const l = typeof listPrice === "number" ? listPrice : NaN;
  if (!Number.isFinite(o) || o <= 0) return null;
  if (!Number.isFinite(l) || l <= 0) return null;
  const ratio = o / l;
  if (ratio > ORIGINAL_LIST_MAX_RATIO || ratio < ORIGINAL_LIST_MIN_RATIO) return null;
  return o;
}

/** True when the pair looks like a feed scale error — for logging and health checks. */
export function isOriginalListPriceCorrupt(
  original: number | null | undefined,
  listPrice: number | null | undefined,
): boolean {
  const o = typeof original === "number" ? original : NaN;
  const l = typeof listPrice === "number" ? listPrice : NaN;
  if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(l) || l <= 0) return false;
  const ratio = o / l;
  return ratio > ORIGINAL_LIST_MAX_RATIO || ratio < ORIGINAL_LIST_MIN_RATIO;
}
