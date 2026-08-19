/**
 * Phase 2 — pure peer comp-grid core (no I/O).
 *
 * peerLevelFromComps adjusts each comp to the SUBJECT's feature level
 * (predicted_i = ln(price_i) + Σβ·(z_subject − z_comp) + de-stale), then takes a
 * recency×similarity-weighted robust centre. Because it prices off homes-like-it,
 * it is NOT subject to ADJ_CLAMP — the whole point for high-end outliers.
 */
import { describe, it, expect } from 'vitest';
import { peerLevelFromComps, cohortOutlierScore, type CompRow } from './anchorService';
import type { AVMInput } from './types';
import { OUTLIER_Z, BAND_LOW, LEGACY_TUNING } from './types';
import type { CoefficientRow } from './matrixService';

const NOW = Date.parse('2026-05-01T00:00:00Z');
const RECENT = '2026-04-01';

const subject: AVMInput = {
  cityRegion: 'Scarborough Village',
  city: 'Toronto',
  propertySubType: 'detached',
  rawPropertySubType: 'Detached',
  buildingAreaTotal: null,
  lotWidth: 50,
  lotDepth: 197,
  bedroomsAboveGrade: 6, bedroomsBelowGrade: 0,
  bathroomsTotalInteger: 5,
  parkingTotal: 8,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 3,
};

const coeffs: CoefficientRow[] = [
  { featureName: 'bedrooms_above_grade', beta: 0.18, mean: 3, std: 1 },
  { featureName: 'bathrooms_total_integer', beta: 0.12, mean: 2.5, std: 1 },
];

function comp(over: Partial<CompRow>): CompRow {
  return {
    close_price: 1_700_000,
    purchase_contract_date: RECENT,
    close_date: RECENT,
    building_area_total: null,
    lot_width: 50,
    lot_depth: 197,
    bedrooms_above_grade: 6, bedrooms_below_grade: 0,
    bathrooms_total_integer: 5,
    parking_total: 8,
    interior_tier: 3,
    exterior_tier: 3,
    basement_tier: 3,
    ...over,
  };
}

describe('peerLevelFromComps', () => {
  it('prices the subject at the level of similar peers (features match → no net adjustment)', () => {
    const comps = [
      comp({ close_price: 1_650_000 }),
      comp({ close_price: 1_700_000 }),
      comp({ close_price: 1_720_000 }),
      comp({ close_price: 1_680_000 }),
      comp({ close_price: 1_750_000 }),
      comp({ close_price: 1_700_000 }),
    ];
    const r = peerLevelFromComps(subject, comps, coeffs, [], NOW);
    expect(r).not.toBeNull();
    expect(Math.exp(r!.anchorLevel)).toBeGreaterThan(1_600_000);
    expect(Math.exp(r!.anchorLevel)).toBeLessThan(1_800_000);
    expect(r!.basis).toBe('peer');
  });

  it('adjusts UP for a larger subject WITHOUT the ±49% clamp ceiling', () => {
    // Comps are smaller 4-bed/3-bath homes at $1.5M; subject is 6-bed/5-bath.
    // Σβ·Δz = 0.18·(3−1) + 0.12·(2.5−0.5) = 0.36 + 0.24 = 0.60 → exp(0.60)=1.82×,
    // which exceeds the clamp ceiling exp(0.4)=1.49×. Proves the grid is uncapped.
    const comps = [
      comp({ close_price: 1_500_000, bedrooms_above_grade: 4, bedrooms_below_grade: 0, bathrooms_total_integer: 3, lot_width: 40, lot_depth: 110 }),
      comp({ close_price: 1_480_000, bedrooms_above_grade: 4, bedrooms_below_grade: 0, bathrooms_total_integer: 3, lot_width: 40, lot_depth: 110 }),
      comp({ close_price: 1_520_000, bedrooms_above_grade: 4, bedrooms_below_grade: 0, bathrooms_total_integer: 3, lot_width: 42, lot_depth: 115 }),
      comp({ close_price: 1_500_000, bedrooms_above_grade: 4, bedrooms_below_grade: 0, bathrooms_total_integer: 3, lot_width: 40, lot_depth: 112 }),
    ];
    const r = peerLevelFromComps(subject, comps, coeffs, [], NOW);
    expect(r).not.toBeNull();
    expect(Math.exp(r!.anchorLevel)).toBeGreaterThan(1_500_000 * Math.exp(0.4));
  });

  it('returns null when there are no comps', () => {
    expect(peerLevelFromComps(subject, [], coeffs, [], NOW)).toBeNull();
  });

  it('returns null when every comp is unusable (no positive price)', () => {
    const comps = [comp({ close_price: 0 }), comp({ close_price: 0 })];
    expect(peerLevelFromComps(subject, comps, coeffs, [], NOW)).toBeNull();
  });

  it('band is the standard error of the estimate (shrinks with nEff), NOT the raw comp spread', () => {
    // Many similar comps with WIDE price dispersion (~$900k–$2.2M, log-SD ≈ 0.27 >
    // BAND_LOW). The point estimate is still well-determined by 10 comps, so the
    // published band must reflect SE ≈ dispersion/√nEff and stay under BAND_LOW —
    // otherwise finish() suppresses a perfectly good estimate (the live bug).
    const prices = [900_000, 1_000_000, 1_100_000, 1_300_000, 1_500_000, 1_700_000, 1_900_000, 2_000_000, 2_100_000, 2_200_000];
    const comps = prices.map((p) => comp({ close_price: p }));
    // LEGACY_TUNING: legacy peer band = SE of the mean (shrinks with nEff). Production
    // (predictive) intentionally widens this to the comp dispersion so a $900k–$2.2M
    // spread reads as the genuinely-uncertain estimate it is (the calibration fix).
    const r = peerLevelFromComps(subject, comps, [], [], NOW, 'peer', LEGACY_TUNING);
    expect(r).not.toBeNull();
    expect(r!.predSD).toBeLessThan(BAND_LOW); // publishable, not suppressed
  });

  it('works with ZERO coefficients — similarity-weighted median of comp prices (CMA)', () => {
    // Untrained cohort: no betas. With similar comps, the grid is just the median
    // of comparable sale prices — exactly a CMA.
    const comps = [
      comp({ close_price: 1_480_000 }),
      comp({ close_price: 1_500_000 }),
      comp({ close_price: 1_520_000 }),
      comp({ close_price: 1_500_000 }),
      comp({ close_price: 1_510_000 }),
    ];
    const r = peerLevelFromComps(subject, comps, [], [], NOW);
    expect(r).not.toBeNull();
    expect(Math.exp(r!.anchorLevel)).toBeCloseTo(1_500_000, -4);
  });
});

describe('cohortOutlierScore — coefficient-free, market-relative atypicality', () => {
  const cohortComp = (over: Partial<CompRow>): CompRow =>
    comp({ bedrooms_above_grade: 3, bedrooms_below_grade: 0, bathrooms_total_integer: 2, lot_width: 30, lot_depth: 100, ...over });

  it('flags a subject far above the cohort (5 baths vs a 2-bath cohort)', () => {
    const cohort = [
      cohortComp({ bathrooms_total_integer: 2 }),
      cohortComp({ bathrooms_total_integer: 3 }),
      cohortComp({ bathrooms_total_integer: 2 }),
      cohortComp({ bathrooms_total_integer: 2 }),
      cohortComp({ bathrooms_total_integer: 3 }),
    ];
    const big: AVMInput = { ...subject, bedroomsAboveGrade: 4, bedroomsBelowGrade: 0, bathroomsTotalInteger: 5, lotWidth: 50 };
    expect(cohortOutlierScore(big, cohort)).toBeGreaterThan(OUTLIER_Z);
  });

  it('does NOT flag a subject that matches its cohort', () => {
    const cohort = [
      cohortComp({}),
      cohortComp({ bathrooms_total_integer: 3 }),
      cohortComp({ bedrooms_above_grade: 4 }),
      cohortComp({}),
      cohortComp({ lot_width: 32 }),
    ];
    const typical: AVMInput = {
      ...subject,
      bedroomsAboveGrade: 3, bedroomsBelowGrade: 0,
      bathroomsTotalInteger: 2,
      lotWidth: 30,
      lotDepth: 100,
    };
    expect(cohortOutlierScore(typical, cohort)).toBeLessThan(OUTLIER_Z);
  });

  it('returns 0 when the cohort is too small to judge', () => {
    expect(cohortOutlierScore(subject, [comp({})])).toBe(0);
  });
});
