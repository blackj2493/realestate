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
  it('prices a low-R² cohort with LOW confidence (R² no longer hard-gates)', () => {
    const lowR2 = { ...BRAMPTON_WEST_DETACHED, r2: 0.4 };
    const r = evaluateMove(bramptonHome, move('finish_basement'), lowR2, P0);
    expect(r.status).toBe('priced');
    expect(r.confidence).toBe('LOW');
  });
  it('suppresses everything in a thin cohort', () => {
    const thin = { ...BRAMPTON_WEST_DETACHED, n: 12 };
    const r = evaluateMove(bramptonHome, move('finish_basement'), thin, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('thin_cohort');
  });
});

describe('evaluateMove — gate coverage', () => {
  const P0 = 861351;

  // 1. at_ceiling: bathrooms well above mean + 2·effStd
  it('at_ceiling: suppresses add_bathroom when bathrooms is above ceiling', () => {
    const ceilHome = subject({
      buildingAreaTotal: 1560, bathroomsTotalInteger: 6, bedroomsAboveGrade: 3,
      parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
    });
    // bathrooms ceiling = 3.0256 + 2 * max(0.891187, 0.9) = 3.0256 + 1.8 = 4.8256
    // 6 >= 4.8256 → at_ceiling
    const r = evaluateMove(ceilHome, move('add_bathroom'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('at_ceiling');
  });

  // 2. null_baseline: missing bathrooms value
  it('null_baseline: suppresses add_bathroom when bathroomsTotalInteger is null', () => {
    const nullHome = subject({
      buildingAreaTotal: 1560, bathroomsTotalInteger: null, bedroomsAboveGrade: 3,
      parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
    });
    const r = evaluateMove(nullHome, move('add_bathroom'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('null_baseline');
  });

  // 3. already_present: basementTier already at 2 (finish_basement target)
  it('already_present: suppresses finish_basement when basement already finished (tier=2)', () => {
    const finishedHome = subject({
      buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
      parkingTotal: 2, basementTier: 2, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
    });
    const r = evaluateMove(finishedHome, move('finish_basement'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('already_present');
  });

  // 4. legal_suite priced: both driving features healthy in Brampton
  it('legal_suite priced: both basement_score and bathrooms_total_integer healthy → priced with positive value', () => {
    // bramptonHome: basementTier=5 (score=5), bathrooms=3 — both below ceiling, healthy betas
    const r = evaluateMove(bramptonHome, move('legal_suite'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeGreaterThan(0);
  });

  // 5. legal_suite suppressed: Erin Mills Condo basement_score is placeholder stub
  it('legal_suite suppressed: Erin Mills Condo basement_score is placeholder → suppressed', () => {
    const condoHome = subject({
      propertySubType: 'Condo Apartment', rawPropertySubType: 'Condo Apartment',
      buildingAreaTotal: 1169, bathroomsTotalInteger: 2, bedroomsAboveGrade: 2,
      parkingTotal: 1, basementTier: 5, interiorTier: 3, exteriorTier: 3,
    });
    const r = evaluateMove(condoHome, move('legal_suite'), ERIN_MILLS_CONDO, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('placeholder');
  });

  // 6. net-gain and payback math for a priced add_bathroom
  it('net-gain / payback math: netGainTyp = valueAddTyp - costTyp and paybackRatio = valueAddTyp / costTyp', () => {
    const r = evaluateMove(bramptonHome, move('add_bathroom'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('priced');
    const m = move('add_bathroom');
    expect(r.netGainTyp).toBe(r.valueAddTyp - m.costTyp);
    expect(r.paybackRatio).toBeCloseTo(r.valueAddTyp / m.costTyp, 10);
    expect(r.paybackRatio).toBeGreaterThan(0);
  });

  // 7. confidence LOW on a wide-band market (predSD >= BAND_MED = 0.15)
  it('confidence LOW when predSD >= BAND_MED (0.15)', () => {
    const wideBandMarket = {
      ...BRAMPTON_WEST_DETACHED,
      anchor: { ...BRAMPTON_WEST_DETACHED.anchor, predSD: 0.2 },
    };
    const r = evaluateMove(bramptonHome, move('add_bathroom'), wideBandMarket, P0);
    expect(r.status).toBe('priced');
    expect(r.confidence).toBe('LOW');
  });
});
