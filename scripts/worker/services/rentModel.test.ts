import { describe, it, expect } from 'vitest';
import {
  isLeaseRecord, extractMonthlyRent, cohortKeyOf, percentile,
  createRentAccumulator, buildRentalIndexRows,
  MIN_MONTHLY_RENT, MAX_MONTHLY_RENT,
  type RawLeaseInput, type RentalIndexRow,
} from './rentModel';

describe('isLeaseRecord', () => {
  it('flags status="Leased" (any case/space) as a lease', () => {
    expect(isLeaseRecord({ status: 'Leased' })).toBe(true);
    expect(isLeaseRecord({ status: '  leased ' })).toBe(true);
    expect(isLeaseRecord({ status: 'Lease' })).toBe(true);
  });
  it('flags transactionType containing lease/rent as a lease', () => {
    expect(isLeaseRecord({ transactionType: 'For Lease' })).toBe(true);
    expect(isLeaseRecord({ transactionType: 'For Rent' })).toBe(true);
  });
  it('treats sold/closed as NOT a lease', () => {
    expect(isLeaseRecord({ status: 'Sold' })).toBe(false);
    expect(isLeaseRecord({ status: 'Closed', transactionType: 'For Sale' })).toBe(false);
    expect(isLeaseRecord({})).toBe(false);
  });
});

describe('extractMonthlyRent', () => {
  it('prefers closePrice, falls back to listPrice', () => {
    expect(extractMonthlyRent({ closePrice: 2800, listPrice: 2900 })).toBe(2800);
    expect(extractMonthlyRent({ closePrice: 0, listPrice: 2900 })).toBe(2900);
  });
  it('rejects out-of-band values (sale prices, junk)', () => {
    expect(extractMonthlyRent({ closePrice: 850000 })).toBeNull(); // a sale leaked in
    expect(extractMonthlyRent({ closePrice: 50 })).toBeNull();      // too low
    expect(extractMonthlyRent({ closePrice: null, listPrice: null })).toBeNull();
  });
  it('honors the band constants', () => {
    expect(extractMonthlyRent({ closePrice: MIN_MONTHLY_RENT })).toBe(MIN_MONTHLY_RENT);
    expect(extractMonthlyRent({ closePrice: MAX_MONTHLY_RENT })).toBe(MAX_MONTHLY_RENT);
    expect(extractMonthlyRent({ closePrice: MAX_MONTHLY_RENT + 1 })).toBeNull();
  });
});

describe('cohortKeyOf', () => {
  it('builds a normalized key from region/subtype/beds/washrooms', () => {
    expect(cohortKeyOf({ cityRegion: 'Brampton East', propertySubType: 'Detached', bedroomsTotal: 3, washroomsFull: 2 }))
      .toBe('brampton east|detached|3|2');
  });
  it('defaults washrooms to 0', () => {
    expect(cohortKeyOf({ cityRegion: 'Ajax', propertySubType: 'Condo Apt', bedroomsTotal: 1 }))
      .toBe('ajax|condo apt|1|0');
  });
  it('returns null when region/subtype/beds missing', () => {
    expect(cohortKeyOf({ propertySubType: 'Detached', bedroomsTotal: 3 })).toBeNull();
    expect(cohortKeyOf({ cityRegion: 'Ajax', bedroomsTotal: 3 })).toBeNull();
    expect(cohortKeyOf({ cityRegion: 'Ajax', propertySubType: 'Detached' })).toBeNull();
  });
});

describe('percentile', () => {
  it('interpolates on a sorted ascending array', () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 0.10)).toBeCloseTo(14, 5);
  });
  it('handles single/empty', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([], 0.5)).toBe(0);
  });
});

const lease = (rent: number, over: Partial<RawLeaseInput> = {}): RawLeaseInput => ({
  status: 'Leased', closePrice: rent, cityRegion: 'Ajax', propertySubType: 'Condo Apt',
  bedroomsTotal: 1, washroomsFull: 1, ...over,
});

describe('buildRentalIndexRows', () => {
  it('aggregates a cohort once it meets MIN_COHORT_SAMPLES', () => {
    const recs = [2000, 2100, 2200, 2300, 2400].map((r) => lease(r));
    const rows = buildRentalIndexRows(recs);
    expect(rows).toHaveLength(1);
    const row = rows[0] as RentalIndexRow;
    expect(row.city_region).toBe('Ajax');
    expect(row.property_sub_type).toBe('Condo Apt');
    expect(row.bedrooms_total).toBe(1);
    expect(row.washrooms_full).toBe(1);
    expect(row.sample_count).toBe(5);
    expect(row.avg_rent).toBe(2200);   // median
    expect(row.p10_rent).toBe(2040);   // 10th pct, interpolated + rounded
  });
  it('drops thin cohorts (< MIN_COHORT_SAMPLES)', () => {
    expect(buildRentalIndexRows([lease(2000), lease(2100)])).toHaveLength(0);
  });
  it('ignores sale rows and out-of-band rents', () => {
    const recs = [
      ...[2000, 2100, 2200, 2300, 2400].map((r) => lease(r)),
      { status: 'Sold', closePrice: 850000, cityRegion: 'Ajax', propertySubType: 'Condo Apt', bedroomsTotal: 1, washroomsFull: 1 },
      lease(50), // below floor -> dropped
    ];
    const rows = buildRentalIndexRows(recs);
    expect(rows[0].sample_count).toBe(5); // sale + junk excluded
  });
  it('createRentAccumulator streams to the same result', () => {
    const acc = createRentAccumulator();
    [2000, 2100, 2200, 2300, 2400].forEach((r) => acc.add(lease(r)));
    expect(acc.finalize()).toEqual(buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r))));
  });
});
