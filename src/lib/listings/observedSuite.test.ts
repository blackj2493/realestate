import { describe, it, expect } from 'vitest';
import { hasObservedSuite } from './observedSuite';

describe('hasObservedSuite', () => {
  it('counts a below-grade kitchen', () => {
    expect(hasObservedSuite({ PropertySubType: 'Detached', KitchensBelowGrade: 1 })).toBe(true);
  });

  it('counts a basement described as an Apartment', () => {
    expect(
      hasObservedSuite({ PropertySubType: 'Detached', Basement: ['Finished', 'Apartment'] })
    ).toBe(true);
  });

  it('accepts the feed\'s string form of KitchensBelowGrade', () => {
    expect(hasObservedSuite({ PropertySubType: 'Semi-Detached', KitchensBelowGrade: '1' })).toBe(true);
  });

  // The whole point of the gate: a SCORE is not a suite. These homes are exactly the
  // 83,882 that carried a 60% rent uplift for a suite nobody had built.
  it('rejects a strong conversion candidate with no second kitchen', () => {
    expect(
      hasObservedSuite({
        PropertySubType: 'Detached',
        Basement: ['Full', 'Separate Entrance', 'Walk-Out'],
        KitchensBelowGrade: 0,
      })
    ).toBe(false);
  });

  // A plex's own rent comp already prices every unit. Adding a suite line charges twice.
  it('rejects plex sub-types even with a below-grade kitchen', () => {
    for (const t of ['Duplex', 'Triplex', 'Multiplex', 'Fourplex']) {
      expect(hasObservedSuite({ PropertySubType: t, KitchensBelowGrade: 1 })).toBe(false);
    }
  });

  it('rejects condos outright (strata killswitch)', () => {
    expect(
      hasObservedSuite({ PropertyType: 'Residential Condo & Other', KitchensBelowGrade: 1 })
    ).toBe(false);
    expect(hasObservedSuite({ PropertySubType: 'Condo Townhouse', KitchensBelowGrade: 1 })).toBe(false);
    expect(
      hasObservedSuite({ PropertySubType: 'Detached', CondoCorpNumber: 1234, KitchensBelowGrade: 1 })
    ).toBe(false);
  });

  it('rejects an empty listing rather than guessing', () => {
    expect(hasObservedSuite({})).toBe(false);
    expect(hasObservedSuite({ PropertySubType: 'Detached', Basement: ['Unfinished'] })).toBe(false);
  });
});
