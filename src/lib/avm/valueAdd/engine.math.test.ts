// src/lib/avm/valueAdd/engine.math.test.ts
import { describe, it, expect } from 'vitest';
import { applyMove, rawStackValue } from './engine';
import { buildMarket, subject } from './__fixtures__/cohorts';
import type { FeatureDelta } from './types';

describe('applyMove', () => {
  it('applies set and add ops immutably', () => {
    const input = subject({ bathroomsTotalInteger: 2, basementTier: 5 });
    const out = applyMove(input, [
      { field: 'bathroomsTotalInteger', op: 'add', value: 1 },
      { field: 'basementTier', op: 'set', value: 2 },
    ]);
    expect(out.bathroomsTotalInteger).toBe(3);
    expect(out.basementTier).toBe(2);
    expect(input.bathroomsTotalInteger).toBe(2); // original untouched
  });
});

describe('rawStackValue (exact exp form)', () => {
  // Synthetic market: one non-count feature, beta 0.1, mean 1000, std 500.
  const market = buildMarket({
    basePrice: 1_000_000, r2: 0.9, n: 100,
    coefficients: [{ featureName: 'building_area_total', beta: 0.1, mean: 1000, std: 500 }],
  });

  it('prices a +500 sqft move as P0·(exp(β·Δz)−1)', () => {
    const input = subject({ buildingAreaTotal: 1000 }); // z0 = 0
    const deltas: FeatureDelta[] = [{ field: 'buildingAreaTotal', op: 'add', value: 500 }]; // z1 = 1.0
    const after = applyMove(input, deltas);
    const value = rawStackValue(input, after, market, 1_000_000);
    // 1e6 * (exp(0.1*1.0) - 1) = 105170.918
    expect(value).toBeCloseTo(105170.918, 1);
  });

  it('returns 0 when nothing changed', () => {
    const input = subject({ buildingAreaTotal: 1000 });
    expect(rawStackValue(input, input, market, 1_000_000)).toBe(0);
  });
});
