// src/lib/avm/valueAdd/calibration.test.ts
import { describe, it, expect } from 'vitest';
import {
  MIN_COHORT_N, MIN_STD_COUNT, isCountFeature, effectiveStd, featureGate,
} from './calibration';
import type { CoefficientRow } from '../matrixService';

const c = (over: Partial<CoefficientRow>): CoefficientRow =>
  ({ featureName: 'x', beta: 0.05, mean: 3, std: 1, ...over });

describe('calibration helpers', () => {
  it('floors std for discrete count features only', () => {
    expect(isCountFeature('bathrooms_total_integer')).toBe(true);
    expect(isCountFeature('basement_score')).toBe(false);
    expect(effectiveStd('bathrooms_total_integer', 0.5)).toBe(MIN_STD_COUNT);
    expect(effectiveStd('basement_score', 0.5)).toBe(0.5);
  });

  it('featureGate rejects negative, zero, placeholder-stub coeffs', () => {
    expect(featureGate(c({ beta: -0.02 }))).toBe('negative_beta');
    expect(featureGate(c({ beta: 0 }))).toBe('placeholder');
    expect(featureGate(c({ beta: 0.05, std: 1, mean: 1 }))).toBe('placeholder'); // condo stub
    expect(featureGate(undefined)).toBe('placeholder'); // missing row
    expect(featureGate(c({ beta: 0.05, std: 0.9, mean: 3 }))).toBeNull(); // healthy
  });

  it('MIN_COHORT_N is a sane overfit floor', () => {
    expect(MIN_COHORT_N).toBeGreaterThanOrEqual(30);
  });
});
