/**
 * The "+1" room is a priced feature, and BOTH sides of the comp math must know it.
 *
 * Measured on 24 months of sales, holding neighbourhood x sub-type x above-grade beds
 * x banded sqft fixed, a den carries a median 7.12% premium and is the dearer home in
 * 67 of 73 well-sampled strata. The AVM ignored it entirely until this feature existed.
 *
 * The subtle failure this guards: the subject premium runs through featureContributions
 * while each comp is neutralized by adjustedLogPrice's own explicit feature list. Drop
 * bedrooms_below_grade from either one and the difference does not cancel — it lands in
 * the anchor and biases every estimate built on those comps.
 */
import { describe, it, expect } from 'vitest';
import { FEATURE_SPECS, featureContributions, subjectAdjustmentTotal } from './features';
import type { AVMInput } from './types';
import type { CoefficientRow } from './matrixService';

const base: AVMInput = {
  cityRegion: 'Waterfront Communities', city: 'Toronto C01',
  propertySubType: 'Condo Apartment', rawPropertySubType: 'Condo Apartment',
  buildingAreaTotal: 800, lotWidth: null, bedroomsAboveGrade: 2, bedroomsBelowGrade: 0,
  bathroomsTotalInteger: 2, parkingTotal: 1, interiorTier: 3, exteriorTier: 3, basementTier: 5,
};
const coeff = (rows: Array<[string, number, number, number]>) =>
  new Map<string, CoefficientRow>(rows.map(([featureName, beta, mean, std]) =>
    [featureName, { featureName, beta, mean, std } as CoefficientRow]));

describe('the plus-room is a priced AVM feature', () => {
  it('is registered with its own matrix name and breakdown key', () => {
    const spec = FEATURE_SPECS.find((s) => s.name === 'bedrooms_below_grade');
    expect(spec).toBeDefined();
    expect(spec!.key).toBe('plusRoomAdjustment');
    expect(spec!.valueOf({ ...base, bedroomsBelowGrade: 1 })).toBe(1);
  });

  it('does NOT fold into the whole-bedroom count', () => {
    const beds = FEATURE_SPECS.find((s) => s.name === 'bedrooms_above_grade')!;
    // A 2+1 must read as 2 above-grade, never 3 — that was the grid bug.
    expect(beds.valueOf({ ...base, bedroomsAboveGrade: 2, bedroomsBelowGrade: 1 })).toBe(2);
  });

  it('lifts the estimate when a den is present and a coefficient exists', () => {
    const c = coeff([['bedrooms_below_grade', 0.05, 0, 1]]);
    const without = subjectAdjustmentTotal({ ...base, bedroomsBelowGrade: 0 }, c);
    const withDen = subjectAdjustmentTotal({ ...base, bedroomsBelowGrade: 1 }, c);
    expect(withDen).toBeGreaterThan(without);
  });

  it('contributes NOTHING when the champion matrix predates the feature', () => {
    // A champion fitted before the retrain simply has no row for it. That must be a
    // no-op, not a crash and not a mean-imputed distortion — it is what lets the code
    // ship ahead of the retrain.
    const stale = coeff([['bedrooms_above_grade', 0.1, 2, 1]]);
    const a = subjectAdjustmentTotal({ ...base, bedroomsBelowGrade: 0 }, stale);
    const b = subjectAdjustmentTotal({ ...base, bedroomsBelowGrade: 3 }, stale);
    expect(b).toBe(a);
    expect(featureContributions({ ...base, bedroomsBelowGrade: 3 }, stale)
      .some((x) => x.key === 'plusRoomAdjustment')).toBe(false);
  });

  it('treats a null plus-room as absent rather than as zero', () => {
    const c = coeff([['bedrooms_below_grade', 0.05, 1, 1]]);
    // mean=1, so an explicit 0 is BELOW average and must push the estimate down,
    // while null must drop out of the sum entirely.
    const explicitZero = subjectAdjustmentTotal({ ...base, bedroomsBelowGrade: 0 }, c);
    const missing = subjectAdjustmentTotal({ ...base, bedroomsBelowGrade: null }, c);
    expect(explicitZero).toBeLessThan(0);
    expect(missing).toBe(0);
  });
});

describe('comp neutralization stays symmetric with the subject premium', () => {
  it("adjustedLogPrice's feature list covers every trained feature", async () => {
    // These two lists are maintained by hand in different files. If a feature is
    // trained but never neutralized out of the comps, its premium is double-counted.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/avm/anchorService.ts', 'utf8'));
    const list = src.slice(src.indexOf('function adjustedLogPrice'));
    for (const spec of FEATURE_SPECS) {
      expect(list.includes(`'${spec.name}'`), `adjustedLogPrice is missing ${spec.name}`).toBe(true);
    }
  });

  it('the comp SELECT pulls every column adjustedLogPrice reads', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/avm/anchorService.ts', 'utf8'));
    const sel = src.slice(src.indexOf('const COMP_SELECT'), src.indexOf('function normPostal'));
    expect(sel).toContain('bedrooms_below_grade');
  });
});
