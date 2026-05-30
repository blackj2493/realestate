// src/lib/avm/valueAdd/engine.report.test.ts
import { describe, it, expect } from 'vitest';
import { buildValueAddReport } from './engine';
import { BRAMPTON_WEST_DETACHED, ERIN_MILLS_CONDO, subject } from './__fixtures__/cohorts';

describe('buildValueAddReport', () => {
  const bramptonHome = subject({
    cityRegion: 'Brampton West',
    buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
    parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
  });

  it('produces a ranked report with a positive headline and bounded score', () => {
    const r = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED);
    expect(r.subjectEstimate).toBeGreaterThan(0);
    expect(r.moves.length).toBe(9);
    // ranked by netGainTyp desc
    const gains = r.moves.map((m) => m.netGainTyp);
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);
    expect(r.headlineUpside).toBeGreaterThan(0);
    expect(r.valueAddScore).toBeGreaterThanOrEqual(0);
    expect(r.valueAddScore).toBeLessThanOrEqual(100);
    expect(r.disclaimer).toMatch(/not an appraisal/i);
    expect(r.basis).toMatch(/Brampton West/);
  });

  it('never lets a suppressed move contribute to the headline', () => {
    const condoHome = subject({
      cityRegion: 'Erin Mills', propertySubType: 'Condo Apartment', rawPropertySubType: 'Condo Apartment',
      buildingAreaTotal: 1169, bathroomsTotalInteger: 2, bedroomsAboveGrade: 2,
      parkingTotal: 1, basementTier: 5, interiorTier: 3, exteriorTier: 3,
    });
    const r = buildValueAddReport(condoHome, ERIN_MILLS_CONDO);
    const basement = r.moves.find((m) => m.key === 'finish_basement')!;
    const bedroom = r.moves.find((m) => m.key === 'add_bedroom')!;
    expect(basement.status).toBe('suppressed');
    expect(bedroom.status).toBe('suppressed');
    // headline is bounded by the stack %-cap and never negative
    expect(r.headlineUpside).toBeGreaterThanOrEqual(0);
  });

  it('returns an unavailable report when the home has no AVM estimate', () => {
    const noEstimate = { ...BRAMPTON_WEST_DETACHED, anchor: { ...BRAMPTON_WEST_DETACHED.anchor, predSD: 0.5 } };
    const r = buildValueAddReport(bramptonHome, noEstimate);
    expect(r.subjectEstimate).toBe(0);
    expect(r.headlineUpside).toBe(0);
    expect(r.valueAddScore).toBe(0);
  });
});
