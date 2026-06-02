import { describe, it, expect } from 'vitest';
import { FEATURE_SPECS, featureContributions } from './features';
import type { AVMInput } from './types';
import type { CoefficientRow } from './matrixService';

const baseInput: AVMInput = {
  cityRegion: 'Test', city: null, propertySubType: 'Detached', rawPropertySubType: 'Detached',
  buildingAreaTotal: 2000, lotWidth: 40, lotDepth: 100,
  bedroomsAboveGrade: 4, bathroomsTotalInteger: 3, parkingTotal: 2,
  interiorTier: 2, exteriorTier: 2, basementTier: 4,
};

describe('FEATURE_SPECS', () => {
  it('exposes all 8 model features with matrix names + breakdown keys', () => {
    const names = FEATURE_SPECS.map((s) => s.name);
    expect(names).toEqual([
      'building_area_total', 'lot_width', 'bedrooms_above_grade',
      'bathrooms_total_integer', 'parking_total', 'basement_score',
      'interior_score', 'exterior_score',
    ]);
  });

  it('valueOf applies the tier→score conversions (6-/5-/10-)', () => {
    const basement = FEATURE_SPECS.find((s) => s.name === 'basement_score')!;
    const interior = FEATURE_SPECS.find((s) => s.name === 'interior_score')!;
    const exterior = FEATURE_SPECS.find((s) => s.name === 'exterior_score')!;
    expect(basement.valueOf(baseInput)).toBe(10 - 4); // 6
    expect(interior.valueOf(baseInput)).toBe(6 - 2);  // 4
    expect(exterior.valueOf(baseInput)).toBe(5 - 2);  // 3
  });

  it('featureContributions still skips nulls and degenerate coeffs', () => {
    const coeff = new Map<string, CoefficientRow>([
      ['bathrooms_total_integer', { featureName: 'bathrooms_total_integer', beta: 0.04, mean: 3, std: 1 }],
      ['lot_width', { featureName: 'lot_width', beta: 0.03, mean: 40, std: 0 }], // std<=0 → skipped
    ]);
    const out = featureContributions({ ...baseInput, bedroomsAboveGrade: null }, coeff);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('bathroomsAdjustment');
    expect(out[0].contribution).toBeCloseTo(0.04 * 0, 10); // value==mean → z=0
  });
});
