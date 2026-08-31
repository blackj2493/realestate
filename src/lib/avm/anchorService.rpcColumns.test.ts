/**
 * A comp row from an RPC that does not RETURN a column carries `undefined`, not null.
 * Before migration 134, sold_fsa_comps and sold_city_comps omitted bedrooms_below_grade;
 * with any coefficients whose den beta was non-zero, (undefined − mean) / std was NaN and
 * EVERY comp from those rungs was dropped: the anchor fell to the prior alone and the peer
 * search found nothing. This pins the guard that makes a missing column a skipped feature.
 */
import { describe, it, expect } from 'vitest';
import { computeAnchorFromData, peerLevelFromComps, type CompRow } from './anchorService';
import type { CoefficientRow } from './matrixService';
import type { AVMInput } from './types';

const subject: AVMInput = {
  cityRegion: '',
  city: 'Kitchener',
  propertySubType: 'Detached',
  rawPropertySubType: 'Detached',
  buildingAreaTotal: 1750,
  lotWidth: 26,
  bedroomsAboveGrade: 3,
  bedroomsBelowGrade: 2,
  bathroomsTotalInteger: 4,
  parkingTotal: 4,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 3,
  postalCode: 'N2N 3P4',
};

/** The exact shape sold_city_comps returned before migration 134: no bedrooms_below_grade key. */
function rpcComp(price: number, date: string): CompRow {
  const c = {
    close_price: price,
    purchase_contract_date: date,
    close_date: null,
    building_area_total: null,
    lot_width: 30,
    lot_depth: 100,
    bedrooms_above_grade: 3,
    bathrooms_total_integer: 3,
    parking_total: 4,
    interior_tier: 3,
    exterior_tier: 3,
    basement_tier: 3,
    postal_code: 'N2N 1A1',
  };
  return c as unknown as CompRow;
}

const coefficients: CoefficientRow[] = [
  { featureName: 'bathrooms_total_integer', beta: 0.06, mean: 2.8, std: 0.8 },
  { featureName: 'bedrooms_below_grade', beta: 0.026, mean: 1.06, std: 0.78 }, // the den beta
];

const comps = [rpcComp(800_000, '2026-08-01'), rpcComp(820_000, '2026-07-15'), rpcComp(790_000, '2026-07-01'), rpcComp(810_000, '2026-06-20')];
const nowMs = Date.parse('2026-08-30T00:00:00Z');

describe('a comp column the RPC did not return', () => {
  it('is skipped by the anchor, not fatal to every comp', () => {
    const a = computeAnchorFromData(subject, coefficients, null, { comps, trend: [], offsets: [], nowMs });
    expect(a.basis).toBe('local');
    expect(a.nEff).toBeGreaterThan(0);
    expect(a.comps).toBe(4);
    expect(Number.isFinite(a.anchorLevel)).toBe(true);
    // The subject's own den term still prices — only the comps lack the column.
    const without = computeAnchorFromData(subject, coefficients.slice(0, 1), null, { comps, trend: [], offsets: [], nowMs });
    expect(a.anchorLevel).toBeCloseTo(without.anchorLevel, 6);
  });

  it('is skipped by the peer grid too', () => {
    const p = peerLevelFromComps(subject, comps, coefficients, [], nowMs);
    expect(p).not.toBeNull();
    expect(p!.nEff).toBeGreaterThan(0);
    expect(Number.isFinite(p!.anchorLevel)).toBe(true);
  });
});
