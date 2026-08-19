/**
 * PRODUCTION behaviour (DEFAULT_TUNING, shipped 2026-06). These pin the intended
 * NEW behaviour that the calibration/tail/suppression work introduced — the legacy
 * mechanics live in calculator.test.ts / calculator.peer.test.ts / peerGrid.test.ts
 * (pinned to LEGACY_TUNING). The end-to-end accuracy gains are validated out-of-time
 * in scripts/admin/avm-experiment.ts; this file locks the unit-level contracts.
 */
import { describe, it, expect } from 'vitest';
import { estimateFromMarketData, type AVMMarketData } from './calculator';
import { computeAnchorFromData, type CompRow, type AnchorInputData } from './anchorService';
import type { AVMInput } from './types';
import { LEGACY_TUNING, CONFIDENCE_HIGH } from './types';
import type { AnchorResult } from './anchorService';
import type { CoefficientRow } from './matrixService';

const LN_800K = Math.log(800_000);
const NOW = Date.parse('2026-05-01T00:00:00Z');

const input: AVMInput = {
  cityRegion: 'Brampton',
  city: 'Brampton',
  propertySubType: 'Detached',
  rawPropertySubType: 'Detached',
  buildingAreaTotal: 2_000,
  lotWidth: 40,
  bedroomsAboveGrade: 4, bedroomsBelowGrade: 0,
  bathroomsTotalInteger: 3,
  parkingTotal: 4,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 3,
};
const outlierInput: AVMInput = { ...input, buildingAreaTotal: null, bedroomsAboveGrade: 6, bedroomsBelowGrade: 0, bathroomsTotalInteger: 5, parkingTotal: 8 };
const strongCoeffs: CoefficientRow[] = [
  { featureName: 'bedrooms_above_grade', beta: 0.18, mean: 3, std: 1 },
  { featureName: 'bathrooms_total_integer', beta: 0.12, mean: 2.5, std: 1 },
  { featureName: 'parking_total', beta: 0.05, mean: 3, std: 1.5 },
];
function anchor(level: number, predSD: number, basis: AnchorResult['basis'] = 'local', nEff = 10): AnchorResult {
  return { anchorLevel: level, predSD, nEff, comps: nEff, basis };
}

describe('PRODUCTION — predictive band (calibration fix)', () => {
  it('a dispersed comp cohort gets a WIDER (honest) band than legacy', () => {
    const prices = [600_000, 700_000, 800_000, 900_000, 1_000_000, 1_100_000, 1_200_000, 1_300_000];
    const comps: CompRow[] = prices.map((p) => ({
      close_price: p, purchase_contract_date: '2026-04-01', close_date: '2026-04-01',
      building_area_total: 2000, lot_width: 40, lot_depth: 110, bedrooms_above_grade: 4, bedrooms_below_grade: 0,
      bathrooms_total_integer: 3, parking_total: 4, interior_tier: 3, exterior_tier: 3, basement_tier: 3,
    }));
    const data: AnchorInputData = { comps, trend: [], offsets: [], nowMs: NOW };
    const prod = computeAnchorFromData(input, [], 800_000, data); // DEFAULT_TUNING (predictive)
    const legacy = computeAnchorFromData(input, [], 800_000, data, LEGACY_TUNING);
    // Predictive predSD includes the irreducible comp dispersion → materially wider.
    expect(prod.predSD).toBeGreaterThan(legacy.predSD * 2);
    expect(prod.predSD).toBeGreaterThan(0.1); // honest band on a $600k–$1.3M cohort
  });
});

describe('PRODUCTION — suppression', () => {
  const market = (sub: string): AVMMarketData & { input: AVMInput } => ({
    anchor: anchor(LN_800K, 0.05), r2: 0.6, basePrice: null, coefficients: [],
    input: { ...input, propertySubType: sub, rawPropertySubType: sub },
  });

  it('suppresses unpriceable types (Vacant Land) → estimate unavailable', () => {
    const m = market('Vacant Land');
    const r = estimateFromMarketData(m.input, m);
    expect(r.estimatedValue).toBe(0);
    expect(r.basis).toBe('none');
    // Legacy would have published a (wrong) number.
    expect(estimateFromMarketData(m.input, m, LEGACY_TUNING).estimatedValue).toBeGreaterThan(0);
  });

  it('does NOT suppress priceable non-canonical types (Link, Duplex)', () => {
    for (const sub of ['Link', 'Duplex']) {
      const m = market(sub);
      expect(estimateFromMarketData(m.input, m).estimatedValue).toBeGreaterThan(0);
    }
  });

  it("suppresses the catastrophic 'floor' basis (trained saturating outlier, no peers)", () => {
    const base: Omit<AVMMarketData, 'peer'> = { anchor: anchor(LN_800K, 0.055), r2: 0.7, basePrice: null, coefficients: strongCoeffs };
    const r = estimateFromMarketData(outlierInput, { ...base, peer: null }); // peer null → floor
    expect(r.estimatedValue).toBe(0); // suppressed (legacy kept the clamped number)
  });
});

describe('PRODUCTION — raised clamp lets premium homes escape the neighbourhood ceiling', () => {
  it('a saturating outlier can exceed the legacy +49% ceiling', () => {
    const coefficients: CoefficientRow[] = [{ featureName: 'building_area_total', beta: 5, mean: 1500, std: 500 }];
    const r = estimateFromMarketData({ ...input, buildingAreaTotal: 3000 }, {
      anchor: anchor(LN_800K, 0.05), r2: 0.6, basePrice: null, coefficients,
    });
    // adjClamp 0.9 → may reach up to ~800k·exp(0.9); must clear the old 0.4 ceiling.
    expect(r.estimatedValue).toBeGreaterThan(Math.round(800_000 * Math.exp(0.4)));
  });
});
