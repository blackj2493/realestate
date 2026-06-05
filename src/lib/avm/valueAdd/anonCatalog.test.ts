import { describe, it, expect } from 'vitest';
import { buildAnonCatalog, isMoveApplicable, type AnonCatalogInput } from './anonCatalog';
import { MOVE_CATALOG } from './moveCatalog';

const BASE: AnonCatalogInput = {
  basementTier: 5,            // "Full Unfinished" — finish_basement applies
  interiorTier: 3,
  exteriorTier: 3,
  bathroomsTotalInteger: 2,
  bedroomsAboveGrade: 3,
  parkingTotal: 1,
  buildingAreaTotal: null,
};

describe('isMoveApplicable', () => {
  it('finish_basement applies when basement is unfinished (tier worse than target)', () => {
    const m = MOVE_CATALOG.find((x) => x.key === 'finish_basement')!;
    expect(isMoveApplicable(m, BASE)).toBe(true);
  });

  it('finish_basement does NOT apply when basement already finished (tier 1)', () => {
    const m = MOVE_CATALOG.find((x) => x.key === 'finish_basement')!;
    expect(isMoveApplicable(m, { ...BASE, basementTier: 1 })).toBe(false);
  });

  it('add_bathroom always applies (pure increment)', () => {
    const m = MOVE_CATALOG.find((x) => x.key === 'add_bathroom')!;
    expect(isMoveApplicable(m, BASE)).toBe(true);
  });
});

describe('buildAnonCatalog', () => {
  it('returns locked=true and applicable items with label + cost ranges only', () => {
    const payload = buildAnonCatalog(BASE);
    expect(payload.locked).toBe(true);
    expect(payload.catalog.length).toBeGreaterThan(0);
    for (const item of payload.catalog) {
      expect(Object.keys(item).sort()).toEqual(
        ['costHigh', 'costLow', 'costTyp', 'key', 'label'].sort(),
      );
      expect(item.costTyp).toBeGreaterThan(0);
    }
  });

  it('COMPLIANCE: payload contains no VOW-derived fields, anywhere', () => {
    const json = JSON.stringify(buildAnonCatalog(BASE));
    for (const forbidden of [
      'estimatedValue', 'subjectEstimate', 'valueAdd', 'valueAddTyp',
      'valueAddLow', 'valueAddHigh', 'headlineUpside', 'valueAddScore',
      'paybackRatio', 'netGainTyp', 'predictiveSD', 'beta',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
