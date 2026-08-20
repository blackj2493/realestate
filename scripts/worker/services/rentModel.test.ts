import { describe, it, expect } from 'vitest';
import {
  isLeaseRecord, extractMonthlyRent, percentile,
  createRentAccumulator, buildRentalIndexRows,
  MIN_MONTHLY_RENT, MAX_MONTHLY_RENT, MIN_COHORT_SAMPLES,
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
  county: 'Toronto', bedroomsTotal: 2, bathroomsTotal: 2, ...over,
});

describe('buildRentalIndexRows (tiered)', () => {
  it('emits every rung for a fully-specified cohort once it meets MIN_COHORT_SAMPLES', () => {
    const rows = buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r)));
    const byTier = Object.fromEntries(rows.map((r) => [r.match_tier, r]));
    expect(new Set(rows.map((r) => r.match_tier)))
      .toEqual(new Set(['nbhd', 'city_bath', 'city', 'city_family', 'county']));

    expect(byTier.nbhd).toMatchObject({
      city_region: 'Willowdale East', city: 'Toronto', property_sub_type: 'Condo Apartment',
      bedrooms_total: 2, bathrooms: 2, avg_rent: 2200, p10_rent: 2040, sample_count: 5,
    });
    expect(byTier.city_bath).toMatchObject({ city_region: null, city: 'Toronto', bathrooms: 2 });
    expect(byTier.city).toMatchObject({ city_region: null, city: 'Toronto', bathrooms: null });
  });

  it('pools different bath counts into the city (baths-relaxed) tier', () => {
    // Neither bath-specific bucket clears the floor on its own, but the baths-relaxed
    // city tier pools them. Sized off MIN_COHORT_SAMPLES so a future floor change
    // re-sizes the fixture instead of breaking the test.
    const perBath = MIN_COHORT_SAMPLES - 1;
    const recs = [
      ...Array.from({ length: perBath }, (_, i) => lease(2000 + i * 100, { bathroomsTotal: 1 })),
      ...Array.from({ length: perBath }, (_, i) => lease(2600 + i * 100, { bathroomsTotal: 2 })),
    ];
    const rows = buildRentalIndexRows(recs);
    expect(rows.find((r) => r.match_tier === 'city_bath')).toBeUndefined();
    const city = rows.find((r) => r.match_tier === 'city') as RentalIndexRow;
    expect(city.sample_count).toBe(perBath * 2);
    expect(city.bathrooms).toBeNull();
  });

  it('publishes a cohort at exactly MIN_COHORT_SAMPLES and suppresses one below it', () => {
    const atFloor = buildRentalIndexRows(
      Array.from({ length: MIN_COHORT_SAMPLES }, (_, i) => lease(2000 + i * 100))
    );
    expect(atFloor.length).toBeGreaterThan(0);
    const belowFloor = buildRentalIndexRows(
      Array.from({ length: MIN_COHORT_SAMPLES - 1 }, (_, i) => lease(2000 + i * 100))
    );
    expect(belowFloor).toEqual([]);
  });

  it('never drops to a cohort of 1 — that would be the listing quoting itself', () => {
    // A single-lease cohort has an empty leave-one-out set, so its "estimate" is the
    // subject's own asking rent. See the backtest table on MIN_COHORT_SAMPLES.
    expect(MIN_COHORT_SAMPLES).toBeGreaterThanOrEqual(3);
  });

  it('a lease missing bath count feeds only the baths-relaxed rungs', () => {
    const rows = buildRentalIndexRows(
      [2000, 2100, 2200, 2300, 2400].map((r) => lease(r, { bathroomsTotal: null, county: null }))
    );
    // Every rung emits TWO cohorts — the plus-room split and the merged fallback it
    // degrades to (122) — so two baths-relaxed rungs give four rows.
    expect(new Set(rows.map((r) => r.match_tier))).toEqual(new Set(['city', 'city_family']));
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.bedrooms_above !== null)).toHaveLength(2);
    expect(rows.filter((r) => r.bedrooms_above === null)).toHaveLength(2);
  });

  // ── migration 124 — the two fallback rungs ──────────────────────────────────────
  it('city_family pools the sub-type and leaves property_sub_type null', () => {
    const rows = buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r)));
    const fam = rows.filter((r) => r.match_tier === 'city_family');
    expect(fam.length).toBeGreaterThan(0);
    for (const r of fam) {
      expect(r.property_sub_type).toBeNull();   // the rung does not key on one sub-type
      expect(r.sub_type_family).toBe('condo');  // Condo Apartment pools into condo
      expect(r.city).toBe('Toronto');           // geography is held exact
      expect(r.county).toBeNull();
    }
  });

  it('county holds the exact sub-type and drops the city', () => {
    const rows = buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r)));
    const cty = rows.filter((r) => r.match_tier === 'county');
    expect(cty.length).toBeGreaterThan(0);
    for (const r of cty) {
      expect(r.county).toBe('Toronto');
      expect(r.city).toBeNull();                       // county rows are not city rows
      expect(r.property_sub_type).toBe('Condo Apartment');
      expect(r.sub_type_family).toBeNull();
    }
  });

  it('emits no county rung when the feed carries no county', () => {
    const rows = buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r, { county: null })));
    expect(rows.some((r) => r.match_tier === 'county')).toBe(false);
    expect(rows.some((r) => r.match_tier === 'city')).toBe(true); // the rest still build
  });

  it('NEVER pools a non-rentable sub-type — a vacant lot cannot inherit a house rent', () => {
    const rows = buildRentalIndexRows(
      [2000, 2100, 2200, 2300, 2400].map((r) => lease(r, { propertySubType: 'Vacant Land' }))
    );
    expect(rows.some((r) => r.match_tier === 'city_family')).toBe(false);
    // The exact-sub-type rungs still build: those can only ever match another vacant lot.
    expect(rows.some((r) => r.match_tier === 'city')).toBe(true);
  });

  it('btrims the sub-type before pooling, so "Semi-Detached " lands in freehold', () => {
    const rows = buildRentalIndexRows(
      [2000, 2100, 2200, 2300, 2400].map((r) => lease(r, { propertySubType: 'Semi-Detached ' }))
    );
    const fam = rows.find((r) => r.match_tier === 'city_family');
    expect(fam?.sub_type_family).toBe('freehold');
    expect(rows.find((r) => r.match_tier === 'city')?.property_sub_type).toBe('Semi-Detached');
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

describe('plus-room split cohorts (migration 122)', () => {
  const lease = (over: Partial<RawLeaseInput>): RawLeaseInput => ({
    transactionType: 'For Lease', listPrice: 2500, city: 'Toronto C01',
    cityRegion: 'Waterfront Communities', propertySubType: 'Condo Apartment',
    bathroomsTotal: 1, ...over,
  });
  const five = (over: Partial<RawLeaseInput>) => [...Array(5)].map(() => lease(over));

  it('keys a 1+den apart from a true 2 bedroom', () => {
    const rows = buildRentalIndexRows([
      ...five({ bedroomsTotal: 2, bedroomsAboveGrade: 1, bedroomsBelowGrade: 1, listPrice: 2450 }),
      ...five({ bedroomsTotal: 2, bedroomsAboveGrade: 2, bedroomsBelowGrade: 0, listPrice: 2950 }),
    ]);
    const nbhd = rows.filter((r) => r.match_tier === 'nbhd');
    const den = nbhd.find((r) => r.bedrooms_above === 1 && r.den === 1);
    const true2 = nbhd.find((r) => r.bedrooms_above === 2 && r.den === 0);
    expect(den?.avg_rent).toBe(2450);
    expect(true2?.avg_rent).toBe(2950);
  });

  it('ALSO emits the merged cohort so a thin split never leaves a listing with no data', () => {
    const rows = buildRentalIndexRows([
      ...five({ bedroomsTotal: 2, bedroomsAboveGrade: 1, bedroomsBelowGrade: 1, listPrice: 2450 }),
      ...five({ bedroomsTotal: 2, bedroomsAboveGrade: 2, bedroomsBelowGrade: 0, listPrice: 2950 }),
    ]);
    const merged = rows.find((r) => r.match_tier === 'nbhd' && r.bedrooms_above === null);
    expect(merged).toBeDefined();
    expect(merged!.bedrooms_total).toBe(2);
    expect(merged!.sample_count).toBe(10);       // both halves pooled
    expect(merged!.avg_rent).toBe(2700);         // the old, blended number
  });

  it('treats an ABSENT below-grade field as no plus-room (the feed omits its zeros)', () => {
    const rows = buildRentalIndexRows(five({ bedroomsTotal: 1, bedroomsAboveGrade: 1, listPrice: 2200 }));
    const split = rows.find((r) => r.match_tier === 'nbhd' && r.bedrooms_above !== null);
    expect(split).toMatchObject({ bedrooms_above: 1, den: 0 });
  });

  it('recovers above-grade when the feed leaves it empty and the total carries the sum', () => {
    const rows = buildRentalIndexRows(
      five({ bedroomsTotal: 3, bedroomsAboveGrade: null, bedroomsBelowGrade: 1, listPrice: 3265 }));
    const split = rows.find((r) => r.match_tier === 'nbhd' && r.bedrooms_above !== null);
    expect(split).toMatchObject({ bedrooms_above: 2, den: 1 });   // 2+1, not 3+1
  });

  it('does not fragment a sub-type the feed ships with a trailing space', () => {
    const rows = buildRentalIndexRows([
      ...five({ propertySubType: 'Semi-Detached ', bedroomsTotal: 2, bedroomsAboveGrade: 2 }),
      ...five({ propertySubType: 'Semi-Detached', bedroomsTotal: 2, bedroomsAboveGrade: 2 }),
    ]);
    const semis = rows.filter((r) => r.match_tier === 'nbhd' && r.property_sub_type === 'Semi-Detached');
    expect(semis).toHaveLength(2);                       // one split cohort + one merged
    expect(semis.every((r) => r.sample_count === 10)).toBe(true);
  });
});
