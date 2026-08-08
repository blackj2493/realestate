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
  propertySubType: 'Detached',
};

/** The funnel's "typical home" defaults, which is what an apartment owner is
 *  actually scored on when they tap the Condo Apartment chip and nothing else. */
const CONDO: AnonCatalogInput = { ...BASE, propertySubType: 'Condo Apartment' };

/** Impossible in an apartment: no basement, no envelope to extend, no land to
 *  build on, and a facade owned by the corporation. */
const IMPOSSIBLE_IN_A_CONDO = [
  'finish_basement',
  'legal_suite',
  'build_addition',
  'build_garage',
  'curb_appeal',
] as const;

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

describe('isMoveApplicable — property-type feasibility', () => {
  it.each(IMPOSSIBLE_IN_A_CONDO)('%s is never offered to an apartment', (key) => {
    const m = MOVE_CATALOG.find((x) => x.key === key)!;
    // Applicable on a detached home with identical attributes — so the only thing
    // rejecting it here is the dwelling type, not the tier arithmetic.
    expect(isMoveApplicable(m, BASE)).toBe(true);
    expect(isMoveApplicable(m, CONDO)).toBe(false);
  });

  it('leaves the moves an apartment owner CAN make', () => {
    for (const key of ['interior_excellent', 'add_bathroom', 'add_bedroom', 'add_parking']) {
      const m = MOVE_CATALOG.find((x) => x.key === key)!;
      expect(isMoveApplicable(m, CONDO)).toBe(true);
    }
  });

  it('a condo townhouse keeps its basement moves (normalizes to Townhouse)', () => {
    // "Condo Townhouse" collapses to 'Townhouse', which we deliberately do NOT gate:
    // freehold towns routinely have basements and we cannot tell the two apart here.
    const m = MOVE_CATALOG.find((x) => x.key === 'finish_basement')!;
    expect(isMoveApplicable(m, { ...BASE, propertySubType: 'Condo Townhouse' })).toBe(true);
    expect(isMoveApplicable(m, { ...BASE, propertySubType: 'Att/Row/Townhouse' })).toBe(true);
  });

  it('an unknown or blank type loses nothing', () => {
    const m = MOVE_CATALOG.find((x) => x.key === 'finish_basement')!;
    expect(isMoveApplicable(m, { ...BASE, propertySubType: 'Houseboat' })).toBe(true);
    expect(isMoveApplicable(m, { ...BASE, propertySubType: '' })).toBe(true);
    expect(isMoveApplicable(m, { ...BASE, propertySubType: null })).toBe(true);
  });

  it('co-ops and co-ownerships are apartments too', () => {
    const m = MOVE_CATALOG.find((x) => x.key === 'build_addition')!;
    expect(isMoveApplicable(m, { ...BASE, propertySubType: 'Co-Op Apartment' })).toBe(false);
    expect(isMoveApplicable(m, { ...BASE, propertySubType: 'Co-Ownership Apartment' })).toBe(false);
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

  it('an apartment teaser offers nothing that needs a basement or a lot', () => {
    const keys = buildAnonCatalog(CONDO).catalog.map((c) => c.key);
    for (const impossible of IMPOSSIBLE_IN_A_CONDO) {
      expect(keys).not.toContain(impossible);
    }
    // ...and is not left empty — interior work is the real apartment move.
    expect(keys).toContain('interior_excellent');
    expect(keys.length).toBeGreaterThan(0);
  });

  it('a detached home still sees the full catalogue', () => {
    const keys = buildAnonCatalog(BASE).catalog.map((c) => c.key);
    for (const impossible of IMPOSSIBLE_IN_A_CONDO) {
      expect(keys).toContain(impossible);
    }
  });
});
