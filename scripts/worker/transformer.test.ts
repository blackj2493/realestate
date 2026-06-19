import { describe, it, expect, vi } from 'vitest';

// Stub the modules that transformer.ts touches at import time so the test
// doesn't try to construct a Supabase client / Typesense client from a missing
// env. Each stub keeps the named exports the file imports — nothing more.
vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));
vi.mock('@/lib/typesense/client', () => ({
  indexListing: vi.fn(),
  deleteListing: vi.fn(),
}));
vi.mock('@/lib/postalCodes', () => ({
  loadPostalCodes: vi.fn(),
  isDataLoaded: () => true,
}));
vi.mock('@/services/BuilderAnalyticsEngine', () => ({
  processBuilderMetrics: vi.fn(() => ({})),
}));
vi.mock('@/lib/schools/nearestSchools', () => ({
  assignSchools: vi.fn(() => ({})),
}));
vi.mock('@/lib/amenities/nearestAmenities', () => ({
  assignAmenities: vi.fn(() => ({})),
}));
// Worker-internal services that hit Supabase at runtime — neutered.
vi.mock('./services/rentAVM', () => ({ fetchRentAVM: vi.fn() }));
vi.mock('./services/ratioPriceCalculator', () => ({
  resolveRatioPrice: vi.fn(),
  fetchMillRate: vi.fn(),
}));
vi.mock('./resolveLocation', () => ({
  resolveLocation: vi.fn(() => ({ location: [0, 0], needsGeocoding: false })),
}));

import {
  calculateCanadianMortgage,
  hashPropertyAddress,
  calculateCarryCost,
  analyzeSuitePotential,
  calculateDerivedMetrics,
} from './transformer';

describe('calculateCanadianMortgage', () => {
  it('returns 0 for non-positive principal / rate / months', () => {
    expect(calculateCanadianMortgage(0, 0.04, 360)).toBe(0);
    expect(calculateCanadianMortgage(500_000, 0, 360)).toBe(0);
    expect(calculateCanadianMortgage(500_000, 0.04, 0)).toBe(0);
    expect(calculateCanadianMortgage(-1, 0.04, 360)).toBe(0);
  });

  it('uses Canadian semi-annual compounding — $500k @ 5% / 25yr ≈ $2,908.02/mo', () => {
    // The canonical Canadian payment under the Interest Act of Canada s.6:
    // effective monthly rate = (1 + r/2)^(1/6) − 1. Delegates to
    // @/lib/finance/canadianMortgage, which has its own dedicated test suite.
    const monthly = calculateCanadianMortgage(500_000, 0.05, 300);
    expect(monthly).toBeCloseTo(2_908.02, 1);
  });

  it('payment scales linearly with principal', () => {
    const a = calculateCanadianMortgage(400_000, 0.05, 300);
    const b = calculateCanadianMortgage(800_000, 0.05, 300);
    expect(b / a).toBeCloseTo(2, 2);
  });

  it('higher rate produces a higher monthly payment', () => {
    const low = calculateCanadianMortgage(500_000, 0.04, 300);
    const high = calculateCanadianMortgage(500_000, 0.06, 300);
    expect(high).toBeGreaterThan(low);
  });
});

describe('hashPropertyAddress', () => {
  it('is deterministic and 64-char hex', () => {
    const raw = {
      StreetNumber: '12',
      StreetName: 'King Street West',
      UnitNumber: '1605',
      PostalCode: 'M5V 3A1',
      City: 'Toronto',
    };
    const h = hashPropertyAddress(raw);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).toBe(hashPropertyAddress(raw));
  });

  it('case + whitespace + punctuation normalized', () => {
    const a = hashPropertyAddress({
      StreetNumber: '12',
      StreetName: 'King Street West',
      UnitNumber: '1605',
      PostalCode: 'M5V 3A1',
      City: 'Toronto',
    });
    const b = hashPropertyAddress({
      StreetNumber: ' 12 ',
      StreetName: 'KING STREET WEST',
      UnitNumber: '#1605',
      PostalCode: 'm5v3a1',
      City: 'toronto',
    });
    expect(a).toBe(b);
  });

  it('different unit → different hash', () => {
    const base = {
      StreetNumber: '12',
      StreetName: 'King',
      PostalCode: 'M5V 3A1',
      City: 'Toronto',
    };
    expect(hashPropertyAddress({ ...base, UnitNumber: '1605' })).not.toBe(
      hashPropertyAddress({ ...base, UnitNumber: '1606' })
    );
  });
});

describe('calculateCarryCost', () => {
  it('returns a complete breakdown that sums to trueCarryCost', () => {
    const r = calculateCarryCost({
      ListPrice: 800_000,
      City: 'Toronto',
      PropertySubType: 'Detached',
      PropertyType: 'Residential',
      TaxAnnualAmount: 6_000,
      AssociationFee: 0,
    });
    const sum =
      r.monthlyMortgage +
      r.monthlyPropertyTax +
      r.monthlyHOA +
      r.monthlyInsurance +
      r.monthlyUtilities +
      r.monthlyCapEx;
    expect(r.trueCarryCost).toBeCloseTo(sum, 1);
  });

  it('condos use AssociationFee + lower insurance baseline', () => {
    const condo = calculateCarryCost({
      ListPrice: 800_000,
      City: 'Toronto',
      PropertySubType: 'Condo',
      AssociationFee: 600,
      TaxAnnualAmount: 4_000,
    });
    const freehold = calculateCarryCost({
      ListPrice: 800_000,
      City: 'Toronto',
      PropertySubType: 'Detached',
      AssociationFee: 0,
      TaxAnnualAmount: 4_000,
    });
    expect(condo.monthlyHOA).toBe(600);
    expect(freehold.monthlyHOA).toBe(0);
    expect(condo.monthlyInsurance).toBeLessThan(freehold.monthlyInsurance);
  });

  it('estimates condo fee at $225/mo when AssociationFee is missing', () => {
    const r = calculateCarryCost({
      ListPrice: 800_000,
      City: 'Toronto',
      PropertySubType: 'Condo',
      AssociationFee: 0, // falsy → estimate used
    });
    expect(r.monthlyHOA).toBe(225);
  });

  it('falls back to municipal mill rate when TaxAnnualAmount is missing', () => {
    const r = calculateCarryCost({
      ListPrice: 800_000,
      City: 'Brampton', // mill rate 0.010 → annual 8000 → monthly 666.67
      PropertySubType: 'Detached',
    });
    expect(r.monthlyPropertyTax).toBeCloseTo(666.67, 1);
  });

  it('multi-family adds inclusive utilities ($350/mo)', () => {
    const multi = calculateCarryCost({
      ListPrice: 800_000,
      City: 'Toronto',
      PropertySubType: 'Multiplex',
      TaxAnnualAmount: 6_000,
    });
    expect(multi.monthlyUtilities).toBe(350);
  });
});

describe('analyzeSuitePotential', () => {
  it('NONE for condos (kill switch)', () => {
    const r = analyzeSuitePotential({ PropertySubType: 'Condo' });
    expect(r.suiteStatus).toBe('NONE');
  });

  it('NONE when a CondoCorpNumber is present (kill switch)', () => {
    const r = analyzeSuitePotential({
      PropertySubType: 'Detached',
      CondoCorpNumber: '1234',
    });
    expect(r.suiteStatus).toBe('NONE');
  });

  it('EXISTING_SUITE when KitchensBelowGrade > 0', () => {
    const r = analyzeSuitePotential({
      PropertySubType: 'Detached',
      KitchensBelowGrade: 1,
    });
    expect(r.suiteStatus).toBe('EXISTING_SUITE');
  });

  it('EXISTING_SUITE for Duplex / Multiplex', () => {
    expect(
      analyzeSuitePotential({ PropertySubType: 'Duplex' }).suiteStatus
    ).toBe('EXISTING_SUITE');
    expect(
      analyzeSuitePotential({ PropertySubType: 'Multiplex' }).suiteStatus
    ).toBe('EXISTING_SUITE');
  });

  it('POTENTIAL_CANDIDATE when score ≥ 3 from finish + entrance + parking', () => {
    const r = analyzeSuitePotential({
      PropertySubType: 'Detached',
      PublicRemarks: 'Beautiful home with separate entrance to basement.',
      Basement: ['Full'],
      ParkingTotal: 2,
      RoomsBelowGrade: 2,
    });
    expect(r.suiteStatus).toBe('POTENTIAL_CANDIDATE');
    expect(r.suiteScore).toBeGreaterThanOrEqual(3);
  });

  it('Fatal parking penalty (-2) bars an otherwise-qualifying property', () => {
    const r = analyzeSuitePotential({
      PropertySubType: 'Detached',
      PublicRemarks: 'Separate entrance to basement.',
      Basement: ['Full'],
      ParkingTotal: 1, // -2 penalty
      RoomsBelowGrade: 2,
    });
    expect(r.suiteStatus).toBe('NONE');
  });
});

describe('calculateDerivedMetrics', () => {
  it('computes DOM, gross yield, and distress flag for a recent listing', () => {
    const r = calculateDerivedMetrics({
      ListPrice: 800_000,
      BedroomsTotal: 3,
      OriginalEntryTimestamp: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      PublicRemarks: 'Bright family home, recent updates.',
    });
    expect(r.calculatedDOM).toBeGreaterThanOrEqual(9);
    expect(r.calculatedDOM).toBeLessThanOrEqual(11);
    expect(r.targetGrossYield).toBeGreaterThan(0);
    expect(r.isDistressed).toBe(false);
  });

  it('flags distressed when DOM > 90', () => {
    const r = calculateDerivedMetrics({
      ListPrice: 800_000,
      BedroomsTotal: 3,
      OriginalEntryTimestamp: new Date(Date.now() - 120 * 86_400_000).toISOString(),
      PublicRemarks: 'Bright family home.',
    });
    expect(r.isDistressed).toBe(true);
  });

  it("flags distressed on remarks keywords like 'as-is' / 'tlc'", () => {
    const r = calculateDerivedMetrics({
      ListPrice: 800_000,
      BedroomsTotal: 3,
      OriginalEntryTimestamp: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      PublicRemarks: 'Estate sale, sold as-is. Needs TLC.',
    });
    expect(r.isDistressed).toBe(true);
  });

  it('flags distressed on a >5% price reduction', () => {
    const r = calculateDerivedMetrics({
      ListPrice: 800_000,
      PreviousListPrice: 900_000, // ~11% cut
      BedroomsTotal: 3,
      OriginalEntryTimestamp: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      PublicRemarks: 'Nice home.',
    });
    expect(r.isDistressed).toBe(true);
  });

  it('detects suite potential from KitchensTotal > 1 (legacy path)', () => {
    const r = calculateDerivedMetrics({
      ListPrice: 800_000,
      BedroomsTotal: 3,
      OriginalEntryTimestamp: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      KitchensTotal: 2,
    });
    expect(r.hasSecondarySuitePotential).toBe(true);
  });
});
