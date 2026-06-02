/**
 * Shared standardized-feature math for the AVM (deterministic, no AI — CLAUDE.md §4).
 *
 * One source of truth for the per-feature log-space contribution β·clamp(z), used by:
 *   • calculator.ts — the subject's adjustment + breakdown + saturation trigger;
 *   • anchorService.ts — the subject premium added to each peer in the comp-grid.
 *
 * Score conventions match the export + ingester:
 *   interior_score = 6 − interiorTier, exterior_score = 5 − exteriorTier,
 *   basement_score = 10 − basementTier.
 */
import type { AVMInput, AVMAdjustmentBreakdown } from './types';
import { Z_CLAMP } from './types';
import type { CoefficientRow } from './matrixService';

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Single registry of the 8 standardized model features. `valueOf` returns the
 * standardized model value from an AVMInput (the SCORE for tier features, via
 * 6−interiorTier / 5−exteriorTier / 10−basementTier), or null when the field is
 * absent. Consumed by featureContributions (AVM) and the valueAdd engine so the
 * two can never disagree on standardization.
 */
export interface FeatureSpec {
  /** AVMInput field a renovation move mutates. */
  inputField: keyof AVMInput;
  /** avm_multiplier_matrix.feature_name. */
  name: string;
  /** AVMAdjustmentBreakdown key. */
  key: keyof AVMAdjustmentBreakdown;
  /** Standardized model value (score for tiers); null = feature absent. */
  valueOf: (input: AVMInput) => number | null;
}

export const FEATURE_SPECS: FeatureSpec[] = [
  { inputField: 'buildingAreaTotal', name: 'building_area_total', key: 'buildingAreaAdjustment', valueOf: (i) => i.buildingAreaTotal },
  { inputField: 'lotWidth', name: 'lot_width', key: 'lotWidthAdjustment', valueOf: (i) => i.lotWidth },
  { inputField: 'bedroomsAboveGrade', name: 'bedrooms_above_grade', key: 'bedroomsAdjustment', valueOf: (i) => i.bedroomsAboveGrade },
  { inputField: 'bathroomsTotalInteger', name: 'bathrooms_total_integer', key: 'bathroomsAdjustment', valueOf: (i) => i.bathroomsTotalInteger },
  { inputField: 'parkingTotal', name: 'parking_total', key: 'parkingAdjustment', valueOf: (i) => i.parkingTotal },
  { inputField: 'basementTier', name: 'basement_score', key: 'basementAdjustment', valueOf: (i) => 10 - i.basementTier },
  { inputField: 'interiorTier', name: 'interior_score', key: 'interiorAdjustment', valueOf: (i) => 6 - i.interiorTier },
  { inputField: 'exteriorTier', name: 'exterior_score', key: 'exteriorAdjustment', valueOf: (i) => 5 - i.exteriorTier },
];

/** Each present feature's standardized contribution β·clamp((x−mean)/std, ±Z_CLAMP). */
export function featureContributions(
  input: AVMInput,
  coeff: Map<string, CoefficientRow>
): { key: keyof AVMAdjustmentBreakdown; contribution: number }[] {
  const out: { key: keyof AVMAdjustmentBreakdown; contribution: number }[] = [];
  for (const spec of FEATURE_SPECS) {
    const value = spec.valueOf(input);
    if (value === null) continue;
    const c = coeff.get(spec.name);
    if (!c || c.beta === 0 || !(c.std > 0)) continue;
    const z = clamp((value - c.mean) / c.std, -Z_CLAMP, Z_CLAMP);
    out.push({ key: spec.key, contribution: c.beta * z });
  }
  return out;
}

/** Subject's total UNCLAMPED log-space adjustment Σ β·clamp(z) over its present features. */
export function subjectAdjustmentTotal(input: AVMInput, coeff: Map<string, CoefficientRow>): number {
  return featureContributions(input, coeff).reduce((a, c) => a + c.contribution, 0);
}
