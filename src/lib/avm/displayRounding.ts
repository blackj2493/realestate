/**
 * Display-layer rounding for AVM-derived dollar figures.
 *
 * Estimates, suggested-offer bands and ask-deltas are model OUTPUTS — rendering them
 * to the dollar ("Offer $1,836,328–$1,932,977", "$116,023 below ask") implies a
 * precision the model doesn't have and makes the same figure look "different" when a
 * neighbouring surface recomputes it a few dollars apart. Round at the DISPLAY boundary
 * only: the stored/computed values (resolveSalePrice, computeDealScore.offerBand, the
 * Deal Score inputs) are untouched, so nothing downstream shifts — only what the user
 * reads. Applied identically wherever a figure renders (the full report + the Quick Look
 * drawer share these components), so the two surfaces can never disagree on rounding.
 */

/** Point estimates, likely-range bands and ask-deltas — nearest $1,000. */
export const ESTIMATE_DISPLAY_STEP = 1_000;

/** Suggested-offer band — a coarser nearest-$5,000 (it's a negotiating range, not a point). */
export const OFFER_BAND_DISPLAY_STEP = 5_000;

/** Round a dollar figure to the nearest `step`. `step <= 0` falls back to whole dollars. */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value)) return value;
  if (!(step > 0)) return Math.round(value);
  return Math.round(value / step) * step;
}
