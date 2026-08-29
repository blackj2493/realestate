import { describe, it, expect } from 'vitest';
import { isUnpriceableType, fsaOf, cohortRungKeys } from './normalizeType';

/**
 * Commercial-gap Phase 0: the dwelling comp AVM must return "unavailable" for
 * Commercial-class subtypes instead of publishing an out-of-distribution number
 * ("what this home is likely to close at" on a warehouse).
 */
describe('isUnpriceableType', () => {
  it('suppresses the original exotic/land set', () => {
    for (const t of [
      'Vacant Land',
      'Farm',
      'Rural Residential',
      'Mobile Home',
      'MobileTrailer', // the feed's actual spelling — the refresh script's private list missed it
      'Parking Space',
      'Locker', // was only in the refresh script's private (drifted) list; now canonical
      'Sale Of Business',
      'Triplex',
      'Fourplex',
      'Multiplex',
    ]) {
      expect(isUnpriceableType(t), t).toBe(true);
    }
  });

  it('suppresses Commercial-class subtypes (exact live spellings)', () => {
    for (const t of [
      'Commercial Retail',
      'Office',
      'Industrial',
      'Investment',
      'Land',
      'Store W Apt/Office',
    ]) {
      expect(isUnpriceableType(t), t).toBe(true);
    }
  });

  it('bare "Land" is exact-match only — Highland/Island style strings stay priceable', () => {
    expect(isUnpriceableType('Land')).toBe(true);
    expect(isUnpriceableType(' land ')).toBe(true);
    expect(isUnpriceableType('Highland Estate Home')).toBe(false);
    expect(isUnpriceableType('Island Cottage')).toBe(false);
  });

  it('keeps the priceable dwelling set publishing', () => {
    for (const t of [
      'Detached',
      'Semi-Detached ',
      'Att/Row/Townhouse',
      'Condo Townhouse',
      'Condo Apartment',
      'Link',
      'Duplex',
      'Modular Home',
    ]) {
      expect(isUnpriceableType(t), t).toBe(false);
    }
  });

  it('empty/missing subtype is not suppressed (falls through to the model gates)', () => {
    expect(isUnpriceableType(undefined)).toBe(false);
    expect(isUnpriceableType(null)).toBe(false);
    expect(isUnpriceableType('')).toBe(false);
  });
});

/**
 * FSA cohort key (feat/avm-fsa-cohort): the comp-cohort fallback for listings whose
 * feed carries no CityRegion (all of Waterloo Region + Brantford). Must stay
 * byte-identical to sold_fsa_comps' predicate upper(left(btrim(postal_code),3))
 * (migration 112) — plus the letter-digit-letter shape guard.
 */
describe('fsaOf', () => {
  it('extracts the FSA from full and compact postal codes', () => {
    expect(fsaOf('N2H 5X8')).toBe('N2H');
    expect(fsaOf('N2H5X8')).toBe('N2H');
    expect(fsaOf('n2h 5x8')).toBe('N2H');
    expect(fsaOf('  N2H 5X8  ')).toBe('N2H');
  });

  it('accepts a bare FSA (rural rows are often FSA-truncated)', () => {
    expect(fsaOf('N0B')).toBe('N0B');
  });

  it('rejects junk that is not letter-digit-letter', () => {
    expect(fsaOf('12345')).toBe('');
    expect(fsaOf('NNN')).toBe('');
    expect(fsaOf('N2')).toBe('');
    expect(fsaOf('2N2')).toBe('');
    expect(fsaOf('')).toBe('');
    expect(fsaOf(null)).toBe('');
    expect(fsaOf(undefined)).toBe('');
  });
});

describe('cohortRungKeys', () => {
  it('orders community, then FSA, then city', () => {
    expect(cohortRungKeys('Bedford Park-Nortown', 'M5M 1A1', 'Toronto C04')).toEqual([
      { rung: 'community', key: 'Bedford Park-Nortown' },
      { rung: 'fsa', key: 'M5M' },
      { rung: 'city', key: 'Toronto C04' },
    ]);
  });

  it('skips the community rung when the feed ships a blank CityRegion', () => {
    // The Waterloo Region / Brantford shape: 10,681 sales dropped before 2026-08-29.
    expect(cohortRungKeys('', 'N2H 5X8', 'Kitchener')).toEqual([
      { rung: 'fsa', key: 'N2H' },
      { rung: 'city', key: 'Kitchener' },
    ]);
  });

  it('treats whitespace-only as blank', () => {
    expect(cohortRungKeys('   ', '  n2h 5x8 ', ' Kitchener ')).toEqual([
      { rung: 'fsa', key: 'N2H' },
      { rung: 'city', key: 'Kitchener' },
    ]);
  });

  it('drops a malformed postal code rather than inventing an FSA', () => {
    expect(cohortRungKeys('', '12345', 'Kitchener')).toEqual([{ rung: 'city', key: 'Kitchener' }]);
    expect(cohortRungKeys('', null, 'Kitchener')).toEqual([{ rung: 'city', key: 'Kitchener' }]);
  });

  it('returns nothing when every key is absent', () => {
    expect(cohortRungKeys(null, null, null)).toEqual([]);
    expect(cohortRungKeys('', '', '')).toEqual([]);
  });

  it('still offers the coarser rungs when a community IS present', () => {
    // Chatham-Kent: CityRegion populated, but 200 sales over 26 communities means the
    // community rung never trains. The FSA and city rungs must still be offered.
    const keys = cohortRungKeys('Wallaceburg', 'N8A 1A1', 'Chatham-Kent');
    expect(keys.map((k) => k.rung)).toEqual(['community', 'fsa', 'city']);
  });
});
