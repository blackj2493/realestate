import { describe, it, expect } from 'vitest';
import { subTypeFamily, isRentableSubType } from './subTypeFamily';

describe('subTypeFamily', () => {
  it('pools condo-tenure stock into condo', () => {
    expect(subTypeFamily('Condo Apartment')).toBe('condo');
    expect(subTypeFamily('Condo Townhouse')).toBe('condo');
    expect(subTypeFamily('Common Element Condo')).toBe('condo');
    expect(subTypeFamily('Co-Ownership Apartment')).toBe('condo');
  });

  it('pools ground-oriented freehold stock into freehold', () => {
    expect(subTypeFamily('Detached')).toBe('freehold');
    expect(subTypeFamily('Att/Row/Townhouse')).toBe('freehold');
    expect(subTypeFamily('Link')).toBe('freehold');
    expect(subTypeFamily('Duplex')).toBe('freehold');
  });

  it('trims first — the feed ships "Semi-Detached " with a trailing space', () => {
    // The same asymmetry cost 4,775 listings their rent estimate before it was fixed
    // in fetchRentAVM; the pooling rule must not reintroduce it.
    expect(subTypeFamily('Semi-Detached ')).toBe('freehold');
    expect(subTypeFamily('Semi-Detached')).toBe(subTypeFamily('Semi-Detached '));
  });

  it('refuses to pool anything with no residential rent', () => {
    for (const st of ['Vacant Land', 'Land', 'Farm', 'Parking Space', 'Timeshare',
                      'Sale Of Business', 'Commercial Retail', 'Office', 'Industrial',
                      'Investment', 'Store W Apt/Office']) {
      expect(subTypeFamily(st)).toBeNull();
    }
  });

  it('refuses "Vacant Land Condo" despite the word condo', () => {
    // It would otherwise match the condo test and let a serviced lot inherit an
    // apartment's rent.
    expect(subTypeFamily('Vacant Land Condo')).toBeNull();
  });

  it('treats absent / empty input as not poolable', () => {
    expect(subTypeFamily(null)).toBeNull();
    expect(subTypeFamily(undefined)).toBeNull();
    expect(subTypeFamily('   ')).toBeNull();
  });

  it('isRentableSubType mirrors the null case', () => {
    expect(isRentableSubType('Detached')).toBe(true);
    expect(isRentableSubType('Vacant Land')).toBe(false);
  });
});
