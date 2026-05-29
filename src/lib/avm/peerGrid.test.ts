/**
 * Phase 2 — pure peer comp-grid core (no I/O).
 *
 * peerLevelFromComps adjusts each comp to the SUBJECT's feature level
 * (predicted_i = ln(price_i) + Σβ·(z_subject − z_comp) + de-stale), then takes a
 * recency×similarity-weighted robust centre. Because it prices off homes-like-it,
 * it is NOT subject to ADJ_CLAMP — the whole point for high-end outliers.
 */
import { describe, it, expect } from 'vitest';
import { peerLevelFromComps, type CompRow } from './anchorService';
import type { AVMInput } from './types';
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
  bedroomsAboveGrade: 6,
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
    bedrooms_above_grade: 6,
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
      comp({ close_price: 1_500_000, bedrooms_above_grade: 4, bathrooms_total_integer: 3, lot_width: 40, lot_depth: 110 }),
      comp({ close_price: 1_480_000, bedrooms_above_grade: 4, bathrooms_total_integer: 3, lot_width: 40, lot_depth: 110 }),
      comp({ close_price: 1_520_000, bedrooms_above_grade: 4, bathrooms_total_integer: 3, lot_width: 42, lot_depth: 115 }),
      comp({ close_price: 1_500_000, bedrooms_above_grade: 4, bathrooms_total_integer: 3, lot_width: 40, lot_depth: 112 }),
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
});
