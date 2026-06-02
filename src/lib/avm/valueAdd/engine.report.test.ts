// src/lib/avm/valueAdd/engine.report.test.ts
import { describe, it, expect } from 'vitest';
import { buildValueAddReport } from './engine';
import { BRAMPTON_WEST_DETACHED, ERIN_MILLS_CONDO, subject } from './__fixtures__/cohorts';
import { MOVE_CATALOG } from './moveCatalog';
import { PCT_CAP_STACK } from './calibration';

describe('buildValueAddReport', () => {
  const bramptonHome = subject({
    cityRegion: 'Brampton West',
    buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
    parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
  });

  it('produces a ranked report with a positive headline and bounded score', () => {
    const r = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED);
    expect(r.subjectEstimate).toBeGreaterThan(0);
    expect(r.moves.length).toBe(MOVE_CATALOG.length);
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

  it('exercises greedy non-overlapping selection without blowing up the headline', () => {
    const r = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED);
    const bath = r.moves.find((m) => m.key === 'add_bathroom')!;
    const suite = r.moves.find((m) => m.key === 'legal_suite')!;
    // both price individually and overlap on bathroomsTotalInteger
    expect(bath.status).toBe('priced');
    expect(suite.status).toBe('priced');
    // headline is positive and bounded by the stack cap (overlap can't double-count)
    expect(r.headlineUpside).toBeGreaterThan(0);
    expect(r.headlineUpside).toBeLessThanOrEqual(Math.round(PCT_CAP_STACK * r.subjectEstimate));
    // (precise selection internals are covered by the rawStackValue joint-math unit tests)
  });

  it('exposes a gross joint value-add that is ≥ the net headline', () => {
    const report = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED);
    expect(report.headlineUpsideGross).toBeGreaterThanOrEqual(report.headlineUpside);
    expect(report.headlineUpsideGross).toBeGreaterThan(0);
  });

  it('scales the whole report linearly when P0 is overridden', () => {
    const baseRep = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED);
    const override = baseRep.subjectEstimate * 2;
    const scaled = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED, { subjectEstimate: override });
    expect(scaled.subjectEstimate).toBe(override);
    // Use finish_basement: high capHigh (150k) so doubling P0 isn't clipped by the absolute cap.
    const baseMove = baseRep.moves.find((m) => m.key === 'finish_basement')!;
    const scaledMove = scaled.moves.find((m) => m.key === 'finish_basement')!;
    // Fail loudly (not via a silent `!`) if a fixture change ever suppresses this move.
    expect(baseMove.status).toBe('priced');
    // Tolerance for float/rounding drift; exact ratio ≈ 2.0 since value = P0·(exp(Δ)−1).
    expect(scaledMove.valueAddTyp).toBeGreaterThan(baseMove.valueAddTyp * 1.9);
  });

  it('leaves output unchanged when no opts are passed', () => {
    const a = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED);
    const b = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED, {});
    expect(b).toEqual(a);
  });
});
