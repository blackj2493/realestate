// src/lib/avm/valueAdd/calibration.ts
import type { CoefficientRow } from '../matrixService';
import type { MoveSpec, SuppressReason } from './types';

/** Cohort sample-size floor — high R² on tiny n is overfit. */
export const MIN_COHORT_N = 30;
/** A single move never adds more than this fraction of the home's value. */
export const PCT_CAP = 0.12;
/** A non-overlapping stack of moves never adds more than this fraction.
 *  Consumed by buildValueAddReport (engine.ts) when capping the joint headline upside. */
export const PCT_CAP_STACK = 0.3;
/** Tiny-std floor for discrete counts: keep a +1 unit move near ~1 std, not 1.5–2. */
export const MIN_STD_COUNT = 0.9;
/** A feature whose current value sits ≥ mean + CEILING_STD·std is "at ceiling". */
export const CEILING_STD = 2.0;
/** Regional $/sqft prior cap for additions (overrides a runaway cohort sqft beta). */
export const PPSF_CAP = 300;
/** Value-Add Score scaling: score = min(100, round(jointFraction · SCORE_K)).
 *  Consumed by buildValueAddReport (engine.ts) to compute the headline Value-Add Score. */
export const SCORE_K = 350;

const COUNT_FEATURES = new Set([
  'bedrooms_above_grade',
  'bathrooms_total_integer',
  'parking_total',
]);

export function isCountFeature(name: string): boolean {
  return COUNT_FEATURES.has(name);
}

/** Floor the std of discrete count features so a single unit isn't over-weighted. */
export function effectiveStd(name: string, std: number): number {
  return isCountFeature(name) ? Math.max(std, MIN_STD_COUNT) : std;
}

/**
 * Reject a feature whose coefficient is untrustworthy for a value-add claim:
 *  - missing row or beta === 0 → 'placeholder'
 *  - beta < 0 → 'negative_beta' (a value-positive reno can never lose value)
 *  - degenerate stub (std ≤ 1 AND mean ≤ 1, e.g. condo basement/lot) → 'placeholder'
 * Returns null when the feature is healthy.
 */
export function featureGate(c: CoefficientRow | undefined): SuppressReason | null {
  if (!c || c.beta === 0) return 'placeholder';
  if (c.beta < 0) return 'negative_beta';
  if (c.std <= 1 && c.mean <= 1) return 'placeholder';
  return null;
}

/** Clamp a raw value-add to the move's absolute cap, the %-of-home cap, and (for
 *  additions) the regional $/sqft cap. Floors at 0. */
export function capValueAdd(
  raw: number,
  move: MoveSpec,
  subjectEstimate: number,
  addedSqft: number
): number {
  let v = Math.max(0, raw);
  v = Math.min(v, move.capHigh);
  v = Math.min(v, PCT_CAP * subjectEstimate);
  if (move.drivingFeatures.includes('building_area_total') && addedSqft > 0) {
    v = Math.min(v, PPSF_CAP * addedSqft);
  }
  return v;
}
