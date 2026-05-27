import { describe, it, expect } from 'vitest';
import {
  deriveInteriorTier,
  deriveExteriorTier,
  deriveBasementTier,
  deriveHasFinishedBasement,
  NEUTRAL_TIER,
  BASEMENT_NONE_TIER,
} from './conditionScoring';

describe('deriveInteriorTier', () => {
  it('returns NEUTRAL_TIER when the payload is null', () => {
    expect(deriveInteriorTier(null)).toBe(NEUTRAL_TIER);
  });

  it('returns NEUTRAL_TIER when InteriorFeatures is missing/empty', () => {
    expect(deriveInteriorTier({})).toBe(NEUTRAL_TIER);
    expect(deriveInteriorTier({ InteriorFeatures: [] })).toBe(NEUTRAL_TIER);
  });

  it('lifts a sauna + in-law combo all the way to tier 1', () => {
    expect(
      deriveInteriorTier({ InteriorFeatures: ['Sauna', 'In-Law Suite'] })
    ).toBe(1);
  });

  it('lifts a single premium amenity to tier 2', () => {
    expect(deriveInteriorTier({ InteriorFeatures: ['Central Vac', 'Built-In Oven'] })).toBe(2);
  });

  it('caps water/air systems at +2 so feature-stuffing does not run away', () => {
    const stuffed = {
      InteriorFeatures: [
        'On Demand Water Heater',
        'HRV',
        'Water Purifier',
        'Water Softener',
      ],
    };
    // 4 system points capped to +2 → only tier 2 from systems alone
    expect(deriveInteriorTier(stuffed)).toBe(2);
  });

  it('treats string lists (comma-separated) the same as arrays', () => {
    expect(
      deriveInteriorTier({ InteriorFeatures: 'Sauna, In-Law Suite' })
    ).toBe(1);
  });
});

describe('deriveExteriorTier', () => {
  it('returns NEUTRAL_TIER when materials + pool + ext are all empty', () => {
    expect(deriveExteriorTier(null)).toBe(NEUTRAL_TIER);
    expect(deriveExteriorTier({})).toBe(NEUTRAL_TIER);
  });

  it('plain brick + no extras lands on tier 3 (the design intent)', () => {
    expect(
      deriveExteriorTier({ ConstructionMaterials: ['Brick'] })
    ).toBe(3);
  });

  it('cheap siding alone drops below tier 3', () => {
    // vinyl is 0 material points; no pool / no exterior features
    const tier = deriveExteriorTier({ ConstructionMaterials: ['Vinyl Siding'] });
    expect(tier).toBeGreaterThanOrEqual(4);
  });

  it('in-ground salt pool + stone + waterfront lifts to tier 1', () => {
    expect(
      deriveExteriorTier({
        ConstructionMaterials: ['Stone'],
        PoolFeatures: ['Inground', 'Salt'],
        WaterfrontYN: true,
      })
    ).toBe(1);
  });

  it('above-ground pool is worth less than in-ground', () => {
    const above = deriveExteriorTier({
      ConstructionMaterials: ['Brick'],
      PoolFeatures: ['Above Ground'],
    });
    const inground = deriveExteriorTier({
      ConstructionMaterials: ['Brick'],
      PoolFeatures: ['Inground'],
    });
    expect(inground).toBeLessThanOrEqual(above);
  });
});

describe('deriveBasementTier', () => {
  it('returns BASEMENT_NONE_TIER when Basement is missing', () => {
    expect(deriveBasementTier(null)).toBe(BASEMENT_NONE_TIER);
    expect(deriveBasementTier({})).toBe(BASEMENT_NONE_TIER);
  });

  it('basement apartment always wins → tier 1', () => {
    expect(deriveBasementTier({ Basement: ['Apartment'] })).toBe(1);
  });

  it('finished + walk-out → tier 1; finished + separate entrance → tier 2', () => {
    expect(deriveBasementTier({ Basement: ['Finished', 'Walk-Out'] })).toBe(1);
    expect(
      deriveBasementTier({ Basement: ['Finished', 'Separate Entrance'] })
    ).toBe(2);
  });

  it('finished but no access bump → tier 3', () => {
    expect(deriveBasementTier({ Basement: ['Finished', 'Full'] })).toBe(3);
  });

  it('distinguishes "Unfinished" from "Finished" (substring trap)', () => {
    // The "Unfinished" token contains the substring "finished" — the function
    // must NOT misclassify it as finished.
    const tier = deriveBasementTier({ Basement: ['Full', 'Unfinished'] });
    // Full + Unfinished, no access → tier 7 (worse than partially finished tier 5)
    expect(tier).toBe(7);
  });

  it('crawl space alone → tier 8', () => {
    expect(deriveBasementTier({ Basement: ['Crawl Space'] })).toBe(8);
  });
});

describe('deriveHasFinishedBasement', () => {
  it('false when no basement data', () => {
    expect(deriveHasFinishedBasement(null)).toBe(false);
    expect(deriveHasFinishedBasement({ Basement: [] })).toBe(false);
  });

  it('true on apartment', () => {
    expect(deriveHasFinishedBasement({ Basement: ['Apartment'] })).toBe(true);
  });

  it('true on Finished + something else', () => {
    expect(deriveHasFinishedBasement({ Basement: ['Finished', 'Full'] })).toBe(true);
  });

  it('does NOT trip on "Unfinished" (substring trap)', () => {
    expect(deriveHasFinishedBasement({ Basement: ['Full', 'Unfinished'] })).toBe(false);
  });
});
