/**
 * GOLDEN MASTER — regression firewall for the peer-comp work (plan
 * whats-going-on-here-sparkling-key).
 *
 * The no-regression invariant: `estimateFromMarketData(input, market)` called
 * WITHOUT a `peer` field must remain byte-identical to its pre-change behaviour
 * for EVERY input — including saturating homes (|Σβz| > ADJ_CLAMP) whose number
 * the peer branch will later change, but ONLY when a peer is supplied.
 *
 * This snapshot captures current behaviour across a representative basket. It is
 * green today; it must stay green after the peer branch lands. If it breaks, the
 * change leaked into the normal path — STOP.
 *
 * (Characterization test: it locks existing behaviour, so it passes on first run
 * by design — that is the point of a regression firewall, not a red-green feature
 * test. New behaviour is driven test-first in calculator.peer.test.ts.)
 */
import { describe, it, expect } from 'vitest';
import { estimateFromMarketData, type AVMMarketData } from './calculator';
import type { AVMInput } from './types';
import type { AnchorResult } from './anchorService';
import type { CoefficientRow } from './matrixService';

const LN_800K = Math.log(800_000);

const typicalInput: AVMInput = {
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

// A luxury outlier whose feature premium saturates the ±ADJ_CLAMP clamp.
const outlierInput: AVMInput = {
  ...typicalInput,
  buildingAreaTotal: null, // mirrors E13206536 (SQFT N/A)
  lotWidth: 50,
  bedroomsAboveGrade: 6,
  bathroomsTotalInteger: 5,
  parkingTotal: 8,
};

function anchor(level: number, predSD: number, basis: AnchorResult['basis'] = 'local'): AnchorResult {
  return { anchorLevel: level, predSD, nEff: 5, comps: 23, basis };
}

// Strong coefficients so the outlier's Σβz blows past ADJ_CLAMP (saturating).
const strongCoeffs: CoefficientRow[] = [
  { featureName: 'bedrooms_above_grade', beta: 0.18, mean: 3, std: 1 },
  { featureName: 'bathrooms_total_integer', beta: 0.12, mean: 2.5, std: 1 },
  { featureName: 'parking_total', beta: 0.05, mean: 3, std: 1.5 },
];

const SCENARIOS: { name: string; input: AVMInput; market: AVMMarketData }[] = [
  {
    name: 'anchor-only (r2 null), high-confidence band',
    input: typicalInput,
    market: { anchor: anchor(LN_800K, 0.05), r2: null, basePrice: null, coefficients: [] },
  },
  {
    name: 'anchor-only (r2 below gate)',
    input: typicalInput,
    market: { anchor: anchor(LN_800K, 0.05), r2: 0.3, basePrice: null, coefficients: strongCoeffs },
  },
  {
    name: 'coefficient typical — clamp does NOT bind',
    input: typicalInput,
    market: { anchor: anchor(LN_800K, 0.05), r2: 0.6, basePrice: null, coefficients: strongCoeffs },
  },
  {
    name: 'coefficient SATURATING outlier — clamp binds (number must not move w/o peer)',
    input: outlierInput,
    market: { anchor: anchor(LN_800K, 0.055), r2: 0.7, basePrice: null, coefficients: strongCoeffs },
  },
  {
    name: 'suppressed — band wider than BAND_LOW',
    input: typicalInput,
    market: { anchor: anchor(LN_800K, 0.3), r2: 0.6, basePrice: null, coefficients: strongCoeffs },
  },
  {
    name: 'medium-confidence band',
    input: typicalInput,
    market: { anchor: anchor(LN_800K, 0.1), r2: 0.6, basePrice: null, coefficients: strongCoeffs },
  },
  {
    name: 'unavailable — basis none',
    input: typicalInput,
    market: { anchor: anchor(0, 0, 'none'), r2: 0.6, basePrice: 800_000, coefficients: strongCoeffs },
  },
];

describe('GOLDEN MASTER — no-peer estimate is frozen', () => {
  for (const s of SCENARIOS) {
    it(s.name, () => {
      const r = estimateFromMarketData(s.input, s.market);
      expect(r).toMatchSnapshot();
    });
  }
});
