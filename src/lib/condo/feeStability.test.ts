import { describe, it, expect } from 'vitest';

import { buildFeeStabilityResult, type AreaStats } from '@/lib/condo/feeStability';

/**
 * Covers the two things the 2026-09-23 card fixes depend on: that the cohort's
 * sub-type reaches the UI, and that the percent it renders is the one the displayed
 * median implies.
 */
const area = (over: Partial<AreaStats> = {}): AreaStats => ({
  medianPsf: 0.4992,
  p25Psf: 0.4273,
  p75Psf: 0.575,
  sampleCount: 52,
  inclusionsMixed: false,
  subType: 'Condo Townhouse',
  ...over,
});

// A 1,400–1,599 sqft unit at $972.22/month — the listing the fixes came from.
const payload = {
  AssociationFee: 972.22,
  LivingAreaRange: '1400-1599',
  PropertySubType: 'Condo Townhouse',
} as Record<string, unknown>;

describe('buildFeeStabilityResult — area cohort', () => {
  it('carries the cohort sub-type through, so the card can name what it compared against', () => {
    // Without this the card says "52 sold condos" while the cohort is 52 sold condo
    // TOWNHOUSES out of 228 sold condos in the area — describing a set several times
    // larger than the one behind the number.
    const r = buildFeeStabilityResult({ payload, cityRegion: 'Don Valley Village', area: area(), corp: null });
    expect(r.area?.subType).toBe('Condo Townhouse');
    expect(r.area?.sampleCount).toBe(52);
  });

  it('passes a null sub-type through rather than inventing one', () => {
    const r = buildFeeStabilityResult({ payload, cityRegion: 'Don Valley Village', area: area({ subType: null }), corp: null });
    expect(r.area?.subType).toBeNull();
  });

  it('reports the unit above the area median, with a percent that rounds to the displayed figure', () => {
    const r = buildFeeStabilityResult({ payload, cityRegion: 'Don Valley Village', area: area(), corp: null });
    expect(r.available).toBe(true);
    expect(r.area?.position).toBe('above');
    // $972.22 / 1499.5 = $0.6484/sqft against a $0.4992 median.
    expect(r.unitFeePsf).toBeCloseTo(0.6484, 3);
    // The card renders Math.round of this. Two decimals moved 28.73 -> 29.89 on one
    // nightly recompute of the same unit, which is why it is rounded for display.
    expect(Math.round(r.area!.pctVsMedian)).toBe(30);
  });

  it('puts a unit inside the interquartile band at "typical"', () => {
    const inBand = { ...payload, AssociationFee: 750 }; // ~$0.50/sqft
    const r = buildFeeStabilityResult({ payload: inBand, cityRegion: 'Don Valley Village', area: area(), corp: null });
    expect(r.area?.position).toBe('typical');
  });
});
