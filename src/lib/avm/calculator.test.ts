import { describe, it, expect } from 'vitest';
import { estimateFromMarketData, type AVMMarketData } from './calculator';
import type { AVMInput } from './types';
import {
  ENGINE_MODE_ANCHOR_ONLY,
  ENGINE_MODE_COEFFICIENT_ADJUSTED,
  CONFIDENCE_HIGH,
  CONFIDENCE_LOW,
  BAND_LOW,
  LEGACY_TUNING,
} from './types';
import type { AnchorResult } from './anchorService';
import type { CoefficientRow } from './matrixService';

// $800k as a log-level anchor: exp(13.5924) ≈ 800000
const LN_800K = Math.log(800_000);

const baseInput: AVMInput = {
  cityRegion: 'Brampton',
  city: 'Brampton',
  propertySubType: 'detached',
  rawPropertySubType: 'Detached',
  buildingAreaTotal: 2_000,
  lotWidth: 40,
  bedroomsAboveGrade: 4,
  bathroomsTotalInteger: 3,
  parkingTotal: 4,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 3,
};

function anchorAt(level: number, predSD: number, basis: AnchorResult['basis'] = 'local'): AnchorResult {
  return { anchorLevel: level, predSD, nEff: 5, comps: 10, basis };
}

describe('estimateFromMarketData — guard rails', () => {
  it("returns the unavailable shape when the anchor's basis is 'none'", () => {
    const market: AVMMarketData = {
      anchor: anchorAt(0, 0, 'none'),
      r2: 0.6,
      basePrice: 800_000,
      coefficients: [],
    };
    const r = estimateFromMarketData(baseInput, market);
    expect(r.estimatedValue).toBe(0);
    expect(r.basis).toBe('none');
    expect(r.confidence).toBe(CONFIDENCE_LOW);
    expect(r.engineMode).toBe(ENGINE_MODE_ANCHOR_ONLY);
  });

  it('returns unavailable when anchorLevel is non-finite', () => {
    const market: AVMMarketData = {
      anchor: anchorAt(Number.NaN, 0.05),
      r2: 0.6,
      basePrice: null,
      coefficients: [],
    };
    expect(estimateFromMarketData(baseInput, market).estimatedValue).toBe(0);
  });

  it('suppresses the estimate when the predictive band exceeds BAND_LOW', () => {
    // A band wider than ~25% (BAND_LOW) is too uncertain to publish.
    const market: AVMMarketData = {
      anchor: anchorAt(LN_800K, BAND_LOW + 0.01),
      r2: null,
      basePrice: null,
      coefficients: [],
    };
    // LEGACY_TUNING: legacy bandLow=0.25 suppression threshold (prod raises it to 0.45).
    const r = estimateFromMarketData(baseInput, market, LEGACY_TUNING);
    expect(r.estimatedValue).toBe(0);
    expect(r.lowBand).toBe(0);
    expect(r.highBand).toBe(0);
    expect(r.basis).toBe('none'); // degraded to 'none' on suppression
    expect(r.confidence).toBe(CONFIDENCE_LOW);
  });
});

describe('estimateFromMarketData — anchor-only path (r2 below coefficient gate)', () => {
  it('returns exactly the anchor when r2 is null and band is high-confidence', () => {
    const market: AVMMarketData = {
      anchor: anchorAt(LN_800K, 0.05), // < BAND_HIGH (0.08) → HIGH confidence
      r2: null,
      basePrice: null,
      coefficients: [],
    };
    const r = estimateFromMarketData(baseInput, market);
    expect(r.engineMode).toBe(ENGINE_MODE_ANCHOR_ONLY);
    expect(r.confidence).toBe(CONFIDENCE_HIGH);
    expect(r.estimatedValue).toBeCloseTo(800_000, -2); // within $100
    expect(r.anchorPrice).toBeCloseTo(800_000, -2);
    expect(r.totalAdjustmentPct).toBe(0);
    expect(r.r2Score).toBeNull();
    // breakdown is all zeros in anchor-only mode
    for (const v of Object.values(r.breakdown)) expect(v).toBe(0);
  });

  it('low r2 (< COEFFICIENT_ENGINE_THRESHOLD) also stays in anchor-only mode', () => {
    const market: AVMMarketData = {
      anchor: anchorAt(LN_800K, 0.05),
      r2: 0.3, // below 0.5 gate
      basePrice: null,
      coefficients: [
        // Even with coefficients available, the gate keeps us out of the coefficient path.
        { featureName: 'building_area_total', beta: 0.5, mean: 1500, std: 500 },
      ],
    };
    const r = estimateFromMarketData(baseInput, market);
    expect(r.engineMode).toBe(ENGINE_MODE_ANCHOR_ONLY);
    expect(r.r2Score).toBe(0.3);
    expect(r.estimatedValue).toBeCloseTo(800_000, -2);
  });
});

describe('estimateFromMarketData — coefficient-adjusted path', () => {
  it('opens the coefficient engine when r2 ≥ threshold (0.5)', () => {
    const coefficients: CoefficientRow[] = [
      { featureName: 'building_area_total', beta: 0.2, mean: 1500, std: 500 },
    ];
    const market: AVMMarketData = {
      anchor: anchorAt(LN_800K, 0.05),
      r2: 0.6,
      basePrice: null,
      coefficients,
    };
    const r = estimateFromMarketData(baseInput, market);
    expect(r.engineMode).toBe(ENGINE_MODE_COEFFICIENT_ADJUSTED);
    expect(r.r2Score).toBe(0.6);
    // 2000 sqft is 1 std above the 1500 mean → z=1 → contribution = 0.2 * 1 = +0.2
    // estimate = 800k * exp(0.2) ≈ 977,122
    expect(r.estimatedValue).toBeGreaterThan(900_000);
    expect(r.breakdown.buildingAreaAdjustment).toBeGreaterThan(0);
  });

  it('positive bedroom z lifts the estimate, negative z lowers it', () => {
    const coefficients: CoefficientRow[] = [
      { featureName: 'bedrooms_above_grade', beta: 0.1, mean: 3, std: 1 },
    ];
    const big = estimateFromMarketData(
      { ...baseInput, bedroomsAboveGrade: 5 },
      {
        anchor: anchorAt(LN_800K, 0.05),
        r2: 0.6,
        basePrice: null,
        coefficients,
      }
    );
    const small = estimateFromMarketData(
      { ...baseInput, bedroomsAboveGrade: 2 },
      {
        anchor: anchorAt(LN_800K, 0.05),
        r2: 0.6,
        basePrice: null,
        coefficients,
      }
    );
    expect(big.estimatedValue).toBeGreaterThan(small.estimatedValue);
  });

  it('skips features whose value is null (so a missing feature contributes 0)', () => {
    const coefficients: CoefficientRow[] = [
      { featureName: 'building_area_total', beta: 0.2, mean: 1500, std: 500 },
    ];
    const withNull = estimateFromMarketData(
      { ...baseInput, buildingAreaTotal: null },
      {
        anchor: anchorAt(LN_800K, 0.05),
        r2: 0.6,
        basePrice: null,
        coefficients,
      }
    );
    // No usable features → estimate falls back to the anchor.
    expect(withNull.estimatedValue).toBeCloseTo(800_000, -2);
    expect(withNull.breakdown.buildingAreaAdjustment).toBe(0);
  });

  it('clamps the cumulative adjustment to ±ADJ_CLAMP (max ~49% upward)', () => {
    // Give one feature an enormous beta so the raw contribution would blow past the clamp.
    const coefficients: CoefficientRow[] = [
      { featureName: 'building_area_total', beta: 5, mean: 1500, std: 500 },
    ];
    // LEGACY_TUNING: pins the legacy ±0.4 clamp (prod raises adjClamp to 0.9 so premium
    // homes can escape the neighbourhood ceiling — the 2M+ under-valuation fix).
    const r = estimateFromMarketData(baseInput, {
      anchor: anchorAt(LN_800K, 0.05),
      r2: 0.6,
      basePrice: null,
      coefficients,
    }, LEGACY_TUNING);
    // exp(ADJ_CLAMP=0.4) ≈ 1.4918, so the estimate must not exceed ~800k * 1.4918.
    expect(r.estimatedValue).toBeLessThanOrEqual(Math.round(800_000 * Math.exp(0.4)) + 1);
  });

  it('ignores coefficients where std=0 (zero-variance feature) — no NaN', () => {
    const coefficients: CoefficientRow[] = [
      { featureName: 'building_area_total', beta: 0.2, mean: 1500, std: 0 },
      { featureName: 'bedrooms_above_grade', beta: 0.1, mean: 3, std: 1 },
    ];
    const r = estimateFromMarketData(baseInput, {
      anchor: anchorAt(LN_800K, 0.05),
      r2: 0.6,
      basePrice: null,
      coefficients,
    });
    expect(Number.isFinite(r.estimatedValue)).toBe(true);
    expect(r.breakdown.buildingAreaAdjustment).toBe(0);
    // bedroomsAboveGrade=4, mean=3, std=1 → z=1, contribution=0.1
    expect(r.breakdown.bedroomsAdjustment).toBeGreaterThan(0);
  });
});

describe('estimateFromMarketData — confidence + band', () => {
  it('emits low/high band that brackets the estimate', () => {
    const r = estimateFromMarketData(baseInput, {
      anchor: anchorAt(LN_800K, 0.05),
      r2: null,
      basePrice: null,
      coefficients: [],
    });
    expect(r.lowBand).toBeLessThan(r.estimatedValue);
    expect(r.highBand).toBeGreaterThan(r.estimatedValue);
  });
});
