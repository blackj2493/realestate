import { describe, it, expect } from 'vitest';
import { isUnpriceableType } from './normalizeType';

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
      'Parking Space',
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
