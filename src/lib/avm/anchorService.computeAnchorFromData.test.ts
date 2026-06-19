/**
 * Unit tests for computeAnchorFromData — the pure anchor-math core extracted from
 * fetchAnchor (the DB-fetch wrapper). Exercises the prior/local/shrinkage legs and
 * the de-stale step on INJECTED market data, so the request path and the out-of-time
 * backtest harness share one verified implementation. Deterministic, no AI.
 */
import { describe, it, expect } from 'vitest';
import {
  computeAnchorFromData,
  type AnchorInputData,
  type CompRow,
  type TrendRow,
} from './anchorService';
import type { AVMInput } from './types';
import { TAU2, SIGMA2, LEGACY_TUNING } from './types';
import type { CoefficientRow } from './matrixService';

const NOW = Date.parse('2026-05-01T00:00:00Z');

const subject: AVMInput = {
  cityRegion: 'Brampton East',
  city: 'Brampton',
  propertySubType: 'detached',
  rawPropertySubType: 'Detached',
  buildingAreaTotal: 2000,
  lotWidth: 40,
  lotDepth: 110,
  bedroomsAboveGrade: 4,
  bathroomsTotalInteger: 3,
  parkingTotal: 4,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 3,
};

function comp(price: number, dateIso: string, over: Partial<CompRow> = {}): CompRow {
  return {
    close_price: price,
    purchase_contract_date: dateIso,
    close_date: dateIso,
    building_area_total: 2000,
    lot_width: 40,
    lot_depth: 110,
    bedrooms_above_grade: 4,
    bathrooms_total_integer: 3,
    parking_total: 4,
    interior_tier: 3,
    exterior_tier: 3,
    basement_tier: 3,
    ...over,
  };
}

function data(over: Partial<AnchorInputData> = {}): AnchorInputData {
  return { comps: [], trend: [], offsets: [], nowMs: NOW, ...over };
}

const noCoeffs: CoefficientRow[] = [];

describe('computeAnchorFromData', () => {
  it('returns basis none (UNAVAILABLE) when there are no comps and no prior', () => {
    const r = computeAnchorFromData(subject, noCoeffs, null, data());
    expect(r.basis).toBe('none');
    expect(r.predSD).toBe(Infinity);
    expect(r.comps).toBe(0);
  });

  it('falls back to the Base_Price prior when no comps and no trend', () => {
    // LEGACY_TUNING: this pins the legacy prior-only predSD (= √TAU2). Production
    // (DEFAULT_TUNING) uses priorSd=0.22 — a wider, honest band for no-comp homes.
    const r = computeAnchorFromData(subject, noCoeffs, 800_000, data(), LEGACY_TUNING);
    expect(r.basis).toBe('parent');
    expect(Math.exp(r.anchorLevel)).toBeCloseTo(800_000, -2);
    expect(r.predSD).toBeCloseTo(Math.sqrt(TAU2), 10);
    expect(r.nEff).toBe(0);
  });

  it('uses g(now)+δ_c as the prior (basis prior) when comps are absent', () => {
    const trend: TrendRow[] = [{ period_end: '2026-06-30', level_log: Math.log(900_000) }];
    const offsets = [{ city_region: 'Brampton East', delta_log: 0.05 }];
    const r = computeAnchorFromData(subject, noCoeffs, null, data({ trend, offsets }));
    expect(r.basis).toBe('prior');
    expect(Math.exp(r.anchorLevel)).toBeCloseTo(900_000 * Math.exp(0.05), -1);
  });

  it('lets dense, tightly-clustered local comps dominate the posterior (basis local)', () => {
    // Many recent same-feature comps near $1.0M with zero coefficients → anchor ≈ $1.0M,
    // local fraction high → basis 'local'.
    const comps = Array.from({ length: 30 }, (_, i) =>
      comp(1_000_000 + (i % 5) * 1_000, '2026-04-15')
    );
    const trend: TrendRow[] = [{ period_end: '2026-06-30', level_log: Math.log(700_000) }];
    const offsets = [{ city_region: 'Brampton East', delta_log: 0 }];
    const r = computeAnchorFromData(subject, noCoeffs, null, data({ comps, trend, offsets }));
    expect(r.basis).toBe('local');
    expect(Math.exp(r.anchorLevel)).toBeGreaterThan(950_000); // pulled toward comps, not the $700k prior
    expect(r.nEff).toBeGreaterThan(5);
    expect(r.comps).toBe(30);
    expect(r.predSD).toBeLessThan(Math.sqrt(SIGMA2)); // shrinkage tightens the band
  });

  it('blends toward the prior when comps are few (basis blend)', () => {
    // Two comps only → local weight small relative to the prior precision → 'blend'.
    const comps = [comp(1_200_000, '2026-04-01'), comp(1_180_000, '2026-04-10')];
    const trend: TrendRow[] = [{ period_end: '2026-06-30', level_log: Math.log(800_000) }];
    const offsets = [{ city_region: 'Brampton East', delta_log: 0 }];
    const r = computeAnchorFromData(subject, noCoeffs, null, data({ comps, trend, offsets }));
    expect(r.basis).toBe('blend');
    // Anchor sits strictly between the prior ($800k) and the local level (~$1.19M).
    expect(Math.exp(r.anchorLevel)).toBeGreaterThan(800_000);
    expect(Math.exp(r.anchorLevel)).toBeLessThan(1_190_000);
  });

  it('de-stales older comps UP via the trend index (older sale → higher contribution today)', () => {
    // Same $1.0M comp, but priced in an earlier, lower-trend period. With a rising
    // trend, the de-stale term g(now)-g(then) > 0 lifts the comp's contribution, so
    // the anchor exceeds the raw comp price.
    const trend: TrendRow[] = [
      { period_end: '2026-06-30', level_log: Math.log(1_100_000) }, // now
      { period_end: '2025-06-30', level_log: Math.log(900_000) }, // a year earlier, lower
    ];
    const offsets = [{ city_region: 'Brampton East', delta_log: 0 }];
    const stale = Array.from({ length: 20 }, () => comp(1_000_000, '2025-05-15'));
    const r = computeAnchorFromData(subject, noCoeffs, null, data({ comps: stale, trend, offsets }));
    // de-stale ≈ ln(1.1M)-ln(0.9M) ≈ +0.20, so the local level ≈ 1.0M·exp(0.20) ≈ $1.22M;
    // anchor is shrunk toward the $1.1M prior but must clear the raw $1.0M comp price.
    expect(Math.exp(r.anchorLevel)).toBeGreaterThan(1_000_000);
  });

  it('reads nowMs from injected data (recency weighting), not the wall clock', () => {
    // A comp ~1 year before the injected NOW is heavily down-weighted vs the prior;
    // pushing nowMs far into the future (relative to the comp) lowers nEff. Verifies
    // the function uses data.nowMs, the property the backtest relies on for t_S.
    const comps = Array.from({ length: 10 }, () => comp(1_000_000, '2025-05-01'));
    const trend: TrendRow[] = [{ period_end: '2026-06-30', level_log: Math.log(1_000_000) }];
    const offsets = [{ city_region: 'Brampton East', delta_log: 0 }];
    const near = computeAnchorFromData(
      subject,
      noCoeffs,
      null,
      data({ comps, trend, offsets, nowMs: Date.parse('2025-06-01T00:00:00Z') })
    );
    const far = computeAnchorFromData(
      subject,
      noCoeffs,
      null,
      data({ comps, trend, offsets, nowMs: Date.parse('2027-06-01T00:00:00Z') })
    );
    // Comps two years stale (far) carry far less effective weight than ~1-month-old (near).
    expect(far.nEff).toBeLessThan(near.nEff);
  });
});
