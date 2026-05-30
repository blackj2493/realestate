// src/lib/avm/valueAdd/engine.calibration.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateMove } from './engine';
import { MOVE_CATALOG } from './moveCatalog';
import {
  BRAMPTON_WEST_DETACHED, ERIN_MILLS_CONDO, CHURCHILL_MEADOWS_TOWNHOUSE, subject,
} from './__fixtures__/cohorts';
import type { MoveKey } from './types';

const move = (k: MoveKey) => MOVE_CATALOG.find((m) => m.key === k)!;

// A typical Brampton detached: features near cohort means, unfinished basement.
const bramptonHome = subject({
  buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
  parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
});

describe('evaluateMove — Brampton West Detached (well-behaved cohort)', () => {
  const P0 = 861351;
  it('prices a basement finish in a sane band', () => {
    const r = evaluateMove(bramptonHome, move('finish_basement'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeGreaterThan(25000);
    expect(r.valueAddTyp).toBeLessThan(70000);
  });
  it('prices an added bathroom in a sane band', () => {
    const r = evaluateMove(bramptonHome, move('add_bathroom'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeGreaterThan(15000);
    expect(r.valueAddTyp).toBeLessThan(55000);
  });
  it('prices an added bedroom in a sane band', () => {
    const r = evaluateMove(bramptonHome, move('add_bedroom'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeGreaterThan(8000);
    expect(r.valueAddTyp).toBeLessThan(40000);
  });
});

describe('evaluateMove — Erin Mills Condo (broken-feature cohort)', () => {
  const P0 = 705579;
  const condoHome = subject({
    propertySubType: 'Condo Apartment', rawPropertySubType: 'Condo Apartment',
    buildingAreaTotal: 1169, bathroomsTotalInteger: 2, bedroomsAboveGrade: 2,
    parkingTotal: 1, basementTier: 5, interiorTier: 3, exteriorTier: 3,
  });
  it('suppresses the placeholder-basement move', () => {
    const r = evaluateMove(condoHome, move('finish_basement'), ERIN_MILLS_CONDO, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('placeholder');
    expect(r.valueAddTyp).toBe(0);
  });
  it('suppresses the negative-beta bedroom move (never shows −$34k)', () => {
    const r = evaluateMove(condoHome, move('add_bedroom'), ERIN_MILLS_CONDO, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('negative_beta');
    expect(r.valueAddTyp).toBe(0);
  });
  it('caps the runaway-beta addition well below the naive +$212k', () => {
    const r = evaluateMove(condoHome, move('build_addition'), ERIN_MILLS_CONDO, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeLessThanOrEqual(Math.round(0.12 * P0)); // ≤ %-of-home cap
    expect(r.valueAddTyp).toBeLessThan(100000);
  });
  it('caps the tiny-std bathroom below the naive +$94k', () => {
    const r = evaluateMove(condoHome, move('add_bathroom'), ERIN_MILLS_CONDO, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeLessThanOrEqual(move('add_bathroom').capHigh);
  });
});

describe('evaluateMove — Churchill Meadows Townhouse', () => {
  const P0 = 801043;
  const thHome = subject({
    propertySubType: 'Townhouse', rawPropertySubType: 'Townhouse',
    buildingAreaTotal: 1436, bathroomsTotalInteger: 3, bedroomsAboveGrade: 2,
    parkingTotal: 1, basementTier: 5, interiorTier: 3, exteriorTier: 3,
  });
  it('caps the tiny-std bedroom below the naive +$94k', () => {
    const r = evaluateMove(thHome, move('add_bedroom'), CHURCHILL_MEADOWS_TOWNHOUSE, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeLessThanOrEqual(move('add_bedroom').capHigh);
    expect(r.valueAddTyp).toBeLessThan(60000);
  });
});

describe('evaluateMove — cohort gates', () => {
  const P0 = 800000;
  it('suppresses everything in a low-R² cohort', () => {
    const lowR2 = { ...BRAMPTON_WEST_DETACHED, r2: 0.4 };
    const r = evaluateMove(bramptonHome, move('finish_basement'), lowR2, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('low_r2');
  });
  it('suppresses everything in a thin cohort', () => {
    const thin = { ...BRAMPTON_WEST_DETACHED, n: 12 };
    const r = evaluateMove(bramptonHome, move('finish_basement'), thin, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('thin_cohort');
  });
});
