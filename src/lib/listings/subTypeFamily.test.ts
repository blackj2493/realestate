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

describe('NO_COMPARABLE_FAMILY — rentable, but nothing may stand in for it', () => {
  it('refuses to pool a mobile or modular home with freehold houses', () => {
    // 827 of these carried a rent comp and every single one came from the pooled rung,
    // i.e. the median rent of detached houses. That is how a $22,900 trailer published
    // a 108% cap rate.
    expect(subTypeFamily('MobileTrailer')).toBeNull();
    expect(subTypeFamily('Modular Home')).toBeNull();
  });

  it('still treats them as RENTABLE, so their own-sub-type rungs stay open', () => {
    // The distinction that matters: nothing comparable is not the same as nothing to
    // rent. Collapsing the two would bar a mobile home from the nbhd / city_bath / city
    // / county rungs, which key on the exact sub-type and are where its honest comp
    // will come from once a cohort exists.
    expect(isRentableSubType('MobileTrailer')).toBe(true);
    expect(isRentableSubType('Modular Home')).toBe(true);
  });

  it('keeps vacant land both unpoolable AND unrentable', () => {
    expect(subTypeFamily('Vacant Land')).toBeNull();
    expect(isRentableSubType('Vacant Land')).toBe(false);
  });

  it('leaves ordinary houses and condos pooling as before', () => {
    expect(subTypeFamily('Detached')).toBe('freehold');
    expect(subTypeFamily('Semi-Detached')).toBe('freehold');
    expect(subTypeFamily('Condo Apartment')).toBe('condo');
    expect(subTypeFamily('Other')).toBe('freehold'); // 120 of these form real cohorts
  });
});
