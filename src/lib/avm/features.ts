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

/** Each present feature's standardized contribution β·clamp((x−mean)/std, ±Z_CLAMP). */
export function featureContributions(
  input: AVMInput,
  coeff: Map<string, CoefficientRow>
): { key: keyof AVMAdjustmentBreakdown; contribution: number }[] {
  const interiorScore = 6 - input.interiorTier;
  const exteriorScore = 5 - input.exteriorTier;
  const basementScore = 10 - input.basementTier;

  const features: { name: string; value: number | null; key: keyof AVMAdjustmentBreakdown }[] = [
    { name: 'building_area_total', value: input.buildingAreaTotal, key: 'buildingAreaAdjustment' },
    { name: 'lot_width', value: input.lotWidth, key: 'lotWidthAdjustment' },
    { name: 'bedrooms_above_grade', value: input.bedroomsAboveGrade, key: 'bedroomsAdjustment' },
    { name: 'bathrooms_total_integer', value: input.bathroomsTotalInteger, key: 'bathroomsAdjustment' },
    { name: 'parking_total', value: input.parkingTotal, key: 'parkingAdjustment' },
    { name: 'basement_score', value: basementScore, key: 'basementAdjustment' },
    { name: 'interior_score', value: interiorScore, key: 'interiorAdjustment' },
    { name: 'exterior_score', value: exteriorScore, key: 'exteriorAdjustment' },
  ];

  const out: { key: keyof AVMAdjustmentBreakdown; contribution: number }[] = [];
  for (const f of features) {
    if (f.value === null) continue;
    const c = coeff.get(f.name);
    if (!c || c.beta === 0 || !(c.std > 0)) continue;
    const z = clamp((f.value - c.mean) / c.std, -Z_CLAMP, Z_CLAMP);
    out.push({ key: f.key, contribution: c.beta * z });
  }
  return out;
}

/** Subject's total UNCLAMPED log-space adjustment Σ β·clamp(z) over its present features. */
export function subjectAdjustmentTotal(input: AVMInput, coeff: Map<string, CoefficientRow>): number {
  return featureContributions(input, coeff).reduce((a, c) => a + c.contribution, 0);
}
