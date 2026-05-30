// src/lib/avm/valueAdd/calibration.test.ts
import { describe, it, expect } from 'vitest';
import {
  MIN_COHORT_N, MIN_STD_COUNT, isCountFeature, effectiveStd, featureGate, capValueAdd,
} from './calibration';
import { MOVE_CATALOG } from './moveCatalog';
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

describe('capValueAdd', () => {
  const bath = MOVE_CATALOG.find((m) => m.key === 'add_bathroom')!;       // capHigh 60000, non-area
  const addition = MOVE_CATALOG.find((m) => m.key === 'build_addition')!; // capHigh 200000, building_area_total

  it('floors a negative raw value at 0', () => {
    expect(capValueAdd(-5000, bath, 800000, 0)).toBe(0);
  });

  it('caps at the move absolute ceiling (capHigh)', () => {
    // raw and subjectEstimate huge → only capHigh binds
    expect(capValueAdd(1_000_000, bath, 100_000_000, 0)).toBe(bath.capHigh);
  });

  it('caps at PCT_CAP (0.12) of the subject estimate', () => {
    // capHigh (200k) does not bind; 0.12 * 500_000 = 60_000 binds; addedSqft 0 → no PPSF
    expect(capValueAdd(1_000_000, addition, 500_000, 0)).toBe(60_000);
  });

  it('caps additions at the regional $/sqft prior (PPSF_CAP × addedSqft)', () => {
    // 300 * 400 = 120_000 binds below capHigh (200k) and %-of-home (huge)
    expect(capValueAdd(1_000_000, addition, 100_000_000, 400)).toBe(120_000);
  });

  it('ignores the $/sqft cap for non-area moves even when addedSqft > 0', () => {
    expect(capValueAdd(50_000, bath, 100_000_000, 400)).toBe(50_000);
  });
});
