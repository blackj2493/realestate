import { describe, it, expect } from 'vitest';
import {
  isLeaseRecord, extractMonthlyRent, percentile,
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
  status: 'Leased', closePrice: rent,
  city: 'Toronto', cityRegion: 'Willowdale East', propertySubType: 'Condo Apartment',
  bedroomsTotal: 2, bathroomsTotal: 2, ...over,
});

describe('buildRentalIndexRows (tiered)', () => {
  it('emits all three tiers for a fully-specified cohort once it meets MIN_COHORT_SAMPLES', () => {
    const rows = buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r)));
    const byTier = Object.fromEntries(rows.map((r) => [r.match_tier, r]));
    expect(new Set(rows.map((r) => r.match_tier))).toEqual(new Set(['nbhd', 'city_bath', 'city']));

    expect(byTier.nbhd).toMatchObject({
      city_region: 'Willowdale East', city: 'Toronto', property_sub_type: 'Condo Apartment',
      bedrooms_total: 2, bathrooms: 2, avg_rent: 2200, p10_rent: 2040, sample_count: 5,
    });
    expect(byTier.city_bath).toMatchObject({ city_region: null, city: 'Toronto', bathrooms: 2 });
    expect(byTier.city).toMatchObject({ city_region: null, city: 'Toronto', bathrooms: null });
  });

  it('pools different bath counts into the city (baths-relaxed) tier', () => {
    // Three 1-bath + two 2-bath leases: neither bath-specific bucket clears min-5,
    // but the baths-relaxed city tier pools all five.
    const recs = [
      ...[2000, 2100, 2200].map((r) => lease(r, { bathroomsTotal: 1 })),
      ...[2600, 2800].map((r) => lease(r, { bathroomsTotal: 2 })),
    ];
    const rows = buildRentalIndexRows(recs);
    expect(rows.find((r) => r.match_tier === 'city_bath')).toBeUndefined(); // 3 and 2 < 5
    const city = rows.find((r) => r.match_tier === 'city') as RentalIndexRow;
    expect(city.sample_count).toBe(5);
    expect(city.bathrooms).toBeNull();
  });

  it('a lease missing bath count still feeds the city (baths-relaxed) tier only', () => {
    const rows = buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r, { bathroomsTotal: null })));
    expect(rows.map((r) => r.match_tier)).toEqual(['city']);
  });

  it('drops thin cohorts (< MIN_COHORT_SAMPLES) and ignores sale/out-of-band rows', () => {
    expect(buildRentalIndexRows([lease(2000), lease(2100)])).toHaveLength(0); // 2 < 5
    const mixed = [
      ...[2000, 2100, 2200, 2300, 2400].map((r) => lease(r)),
      { status: 'Sold', closePrice: 850000, city: 'Toronto', cityRegion: 'Willowdale East', propertySubType: 'Condo Apartment', bedroomsTotal: 2, bathroomsTotal: 2 },
      lease(50), // below floor
    ];
    expect((buildRentalIndexRows(mixed).find((r) => r.match_tier === 'nbhd') as RentalIndexRow).sample_count).toBe(5);
  });

  it('createRentAccumulator streams to the same result as buildRentalIndexRows', () => {
    const acc = createRentAccumulator();
    [2000, 2100, 2200, 2300, 2400].forEach((r) => acc.add(lease(r)));
    expect(acc.finalize()).toEqual(buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r))));
  });
});
