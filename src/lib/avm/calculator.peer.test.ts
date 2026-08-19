/**
 * Phase 1 — saturation trigger + peer/floor handling in the pure calculator.
 *
 * Invariant under test: the peer branch changes the number ONLY when the clamp
 * was already binding (|Σβz| > ADJ_CLAMP). A peer supplied for a non-saturating
 * home is ignored; a non-supplied peer leaves saturating homes on the clamp path.
 */
import { describe, it, expect } from 'vitest';
import { estimateFromMarketData, isFeatureOutlier, type AVMMarketData } from './calculator';
import type { AVMInput } from './types';
import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, MIN_PEERS_FOR_HIGH, LEGACY_TUNING } from './types';
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
  bedroomsAboveGrade: 4, bedroomsBelowGrade: 0,
  bathroomsTotalInteger: 3,
  parkingTotal: 4,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 3,
};
const outlierInput: AVMInput = {
  ...typicalInput,
  buildingAreaTotal: null,
  lotWidth: 50,
  bedroomsAboveGrade: 6, bedroomsBelowGrade: 0,
  bathroomsTotalInteger: 5,
  parkingTotal: 8,
};

const strongCoeffs: CoefficientRow[] = [
  { featureName: 'bedrooms_above_grade', beta: 0.18, mean: 3, std: 1 },
  { featureName: 'bathrooms_total_integer', beta: 0.12, mean: 2.5, std: 1 },
  { featureName: 'parking_total', beta: 0.05, mean: 3, std: 1.5 },
];

function anchor(level: number, predSD: number, basis: AnchorResult['basis'], nEff = 10): AnchorResult {
  return { anchorLevel: level, predSD, nEff, comps: Math.round(nEff), basis };
}

describe('isFeatureOutlier — the cohort model implies a premium beyond the clamp', () => {
  it('true for a luxury outlier with strong coefficients', () => {
    expect(isFeatureOutlier(outlierInput, strongCoeffs)).toBe(true);
  });
  it('false for a typical home (implied premium within the legacy clamp)', () => {
    // LEGACY_TUNING peerTrigger=0.4 (prod lowers it to 0.25 to route more premium
    // homes to the well-calibrated peer grid). This home's Σβz≈0.27 sits between them.
    expect(isFeatureOutlier(typicalInput, strongCoeffs, LEGACY_TUNING)).toBe(false);
  });
  it('is engine-independent — still true for an outlier even when r2 would be below the gate', () => {
    // The outlier signal must NOT depend on r2: anchor-only cohorts (low r2) are
    // exactly where a big home silently sits at the neighbourhood level.
    expect(isFeatureOutlier(outlierInput, strongCoeffs)).toBe(true);
  });
  it('false with no coefficients (cannot assess)', () => {
    expect(isFeatureOutlier(outlierInput, [])).toBe(false);
  });
});

describe('estimateFromMarketData — peer branch (saturating home only)', () => {
  const base: Omit<AVMMarketData, 'peer'> = {
    anchor: anchor(LN_800K, 0.055, 'local'),
    r2: 0.7,
    basePrice: null,
    coefficients: strongCoeffs,
  };

  it('uses the peer-grid level as the estimate when a peer is supplied', () => {
    const peer = anchor(Math.log(1_700_000), 0.06, 'peer', 12);
    const r = estimateFromMarketData(outlierInput, { ...base, peer });
    expect(r.estimatedValue).toBeCloseTo(1_700_000, -3); // within ~$1k
    expect(r.basis).toBe('peer');
  });

  it('does not stamp HIGH when effective peers are below MIN_PEERS_FOR_HIGH, even with a tight band', () => {
    const thin = anchor(Math.log(1_700_000), 0.04, 'peer', MIN_PEERS_FOR_HIGH - 4);
    const r = estimateFromMarketData(outlierInput, { ...base, peer: thin });
    expect(r.confidence).not.toBe(CONFIDENCE_HIGH);
  });

  it('allows HIGH when the peer band is tight AND effective peers clear the floor', () => {
    const solid = anchor(Math.log(1_700_000), 0.04, 'peer', MIN_PEERS_FOR_HIGH + 4);
    const r = estimateFromMarketData(outlierInput, { ...base, peer: solid });
    expect(r.confidence).toBe(CONFIDENCE_HIGH);
  });

  it('floor mode (peer === null): keeps the clamped number but caps confidence and relabels basis', () => {
    // LEGACY_TUNING: legacy 'floor' KEEPS the clamped number. Production suppresses it
    // (suppressFloor=true) — see calculator.production.test.ts — because the backtest
    // showed 'floor' is a −42…−77% under-estimate.
    const clamped = estimateFromMarketData(outlierInput, base, LEGACY_TUNING); // no peer → today's clamped value
    const floored = estimateFromMarketData(outlierInput, { ...base, peer: null }, LEGACY_TUNING);
    expect(floored.estimatedValue).toBe(clamped.estimatedValue); // number unchanged
    expect(floored.basis).toBe('floor');
    expect(floored.confidence).not.toBe(CONFIDENCE_HIGH); // capped down from HIGH
    expect([CONFIDENCE_MEDIUM, 'LOW']).toContain(floored.confidence);
  });
});

describe('estimateFromMarketData — ANCHOR-ONLY outlier (r2 below gate, the E13206536 case)', () => {
  // r2 below COEFFICIENT_ENGINE_THRESHOLD → today the estimate is just the anchor
  // (~$800k) with no feature lift, yet the home is a clear outlier. Peer treatment
  // must still engage off the engine-independent trigger.
  const anchorOnly: Omit<AVMMarketData, 'peer'> = {
    anchor: anchor(LN_800K, 0.055, 'local'),
    r2: 0.3,
    basePrice: 800_000,
    coefficients: strongCoeffs,
  };

  it('uses the peer-grid level (not the bare anchor) when peers are found', () => {
    const peer = anchor(Math.log(1_700_000), 0.06, 'peer', 12);
    const r = estimateFromMarketData(outlierInput, { ...anchorOnly, peer });
    expect(r.estimatedValue).toBeCloseTo(1_700_000, -3);
    expect(r.basis).toBe('peer');
  });

  it('floor mode (peer === null): keeps the anchor number but caps confidence and relabels basis', () => {
    // LEGACY_TUNING: legacy 'floor' keeps the number (prod suppresses — see production test).
    const bare = estimateFromMarketData(outlierInput, anchorOnly, LEGACY_TUNING); // ~anchor, no peer
    const floored = estimateFromMarketData(outlierInput, { ...anchorOnly, peer: null }, LEGACY_TUNING);
    expect(floored.estimatedValue).toBe(bare.estimatedValue);
    expect(floored.basis).toBe('floor');
    expect(floored.confidence).not.toBe(CONFIDENCE_HIGH);
  });
});

describe('estimateFromMarketData — UNTRAINED cohort (zero coefficients, the Scarborough Village case)', () => {
  // coeffCount 0 → no Σβz signal; the async layer decides via market-relative
  // atypicality and supplies a peer. estimateFromMarketData must honor it even
  // though isFeatureOutlier (coefficient-based) can't fire.
  const noCoeff: Omit<AVMMarketData, 'peer'> = {
    anchor: anchor(LN_800K, 0.055, 'local'),
    r2: null,
    basePrice: 800_000,
    coefficients: [],
  };

  it('uses the peer estimate even with zero coefficients', () => {
    const peer = anchor(Math.log(1_700_000), 0.06, 'peer', 12);
    const r = estimateFromMarketData(outlierInput, { ...noCoeff, peer });
    expect(r.estimatedValue).toBeCloseTo(1_700_000, -3);
    expect(r.basis).toBe('peer');
  });

  it('thin-comp fallback (peer === null): keeps the anchor number, caps confidence, uses anchor basis (not floor)', () => {
    const bare = estimateFromMarketData(outlierInput, noCoeff);
    const thinComp = estimateFromMarketData(outlierInput, { ...noCoeff, peer: null });
    expect(thinComp.estimatedValue).toBe(bare.estimatedValue);
    // Untrained: basis stays as the anchor's own honest basis (e.g. 'local'), NOT 'floor'
    // ('floor' implies a trained saturating outlier — that copy is wrong for typical untrained homes).
    expect(thinComp.basis).toBe(bare.basis);
    expect(thinComp.basis).not.toBe('floor');
    expect(thinComp.confidence).not.toBe(CONFIDENCE_HIGH);
  });

  it('peer undefined → untouched plain anchor-only', () => {
    expect(estimateFromMarketData(outlierInput, noCoeff).basis).toBe('local');
  });
});

describe('estimateFromMarketData — peer ignored unless the clamp binds (no-regression guard)', () => {
  it('a peer supplied for a NON-saturating home is ignored (number frozen)', () => {
    const base: Omit<AVMMarketData, 'peer'> = {
      anchor: anchor(LN_800K, 0.055, 'local'),
      r2: 0.7,
      basePrice: null,
      coefficients: strongCoeffs,
    };
    const peer = anchor(Math.log(1_700_000), 0.06, 'peer', 12);
    // LEGACY_TUNING peerTrigger=0.4 → this home is non-saturating → peer ignored.
    const withPeer = estimateFromMarketData(typicalInput, { ...base, peer }, LEGACY_TUNING);
    const noPeer = estimateFromMarketData(typicalInput, base, LEGACY_TUNING);
    expect(withPeer.estimatedValue).toBe(noPeer.estimatedValue);
    expect(withPeer.basis).toBe(noPeer.basis);
  });
});
