/**
 * AVM Calculator — anchor-and-adjust over an interpretable standardized model.
 *
 *   estimate = anchor × exp( clamp( Σ beta_i · clamp((x_i − mean_i)/std_i, ±Z), ±ADJ ) )
 *
 * A typical home (every present feature at its market mean → all z=0) returns
 * exactly the anchor. Per-feature beta/mean/std come from the offline RidgeCV
 * fit (avm_multiplier_matrix); they are constants, so this is deterministic
 * arithmetic with no AI at request time (CLAUDE.md §4).
 *
 * Score conventions (must match the export + ingester):
 *   interior_score = 6 − interiorTier,  exterior_score = 5 − exteriorTier,
 *   basement_score = 10 − basementTier.
 *
 * Anchor: see anchorService.ts — de-staled, recency-weighted, robust + shrunk
 * local-level with a predictive SD. Replaces the old "≥5 90-day comps or
 * Base_Price fallback" gate; confidence is now derived from the band width,
 * not from a comp-count threshold.
 *
 * Gate: coefficient engine applies only when audit R² ≥ COEFFICIENT_ENGINE_THRESHOLD;
 * otherwise the result is anchor + band only.
 */

import type { AVMInput, AVMResult, AVMAdjustmentBreakdown, AnchorBasis } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAnchor, fetchPeerAnchor, type AnchorResult } from './anchorService';
import { fetchAuditInfo } from './auditService';
import { fetchCoefficients, type CoefficientRow } from './matrixService';
import { clamp, featureContributions, subjectAdjustmentTotal } from './features';
import {
  ENGINE_MODE_COEFFICIENT_ADJUSTED,
  ENGINE_MODE_ANCHOR_ONLY,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  CONFIDENCE_LOW,
  COEFFICIENT_ENGINE_THRESHOLD,
  ADJ_CLAMP,
  BAND_HIGH,
  BAND_MED,
  BAND_LOW,
  MIN_PEERS_FOR_HIGH,
} from './types';

/**
 * Pre-loaded per-market constants the estimate needs. Lets the request-time
 * path (calculateAVM) and the nightly batch precompute share ONE implementation
 * of the model math.
 */
export interface AVMMarketData {
  /** Anchor pipeline output: log-level + predictive SD + n_eff + basis. */
  anchor: AnchorResult;
  /** Model accuracy — gates the coefficient engine. */
  r2: number | null;
  /** Audit Base_Price — surfaced for legacy display; anchor service uses it as a fallback prior. */
  basePrice: number | null;
  /** Cohort sample size (avm_audit_report.total_sales_analyzed). Used by the
   * valueAdd engine to suppress thin cohorts; the AVM estimate ignores it. */
  n?: number | null;
  /** Per-feature standardized coefficients (beta/mean/std) for this market. */
  coefficients: CoefficientRow[];
  /**
   * Peer comp-grid anchor for SATURATING outliers (CLAUDE.md §10). Supplied by the
   * async layer ONLY when isSaturating() is true:
   *   • AnchorResult → price the subject off homes like it (basis 'peer');
   *   • null         → saturating but too few peers → keep the clamped number as a
   *                    neighbourhood FLOOR with capped confidence (basis 'floor');
   *   • undefined    → not evaluated → the normal clamp path runs unchanged.
   * Honored only when the clamp actually binds, so non-saturating homes are frozen.
   */
  peer?: AnchorResult | null;
}

/**
 * True when the cohort model implies a feature premium beyond the ±ADJ_CLAMP
 * clamp — the subject is a feature-space outlier the standard estimate cannot
 * price (the clamp distorts it when the engine is on; anchor-only mode ignores it
 * entirely). ENGINE-INDEPENDENT BY DESIGN: low-R² (anchor-only) cohorts are
 * exactly where a large home silently sits at the neighbourhood level, so this
 * must NOT gate on R². The sole trigger for the peer comp-grid; for every typical
 * home the implied premium is within the clamp and the estimate is unchanged.
 */
export function isFeatureOutlier(input: AVMInput, coefficients: CoefficientRow[]): boolean {
  if (coefficients.length === 0) return false; // can't assess without a model
  const coeff = new Map(coefficients.map((c) => [c.featureName, c]));
  return Math.abs(subjectAdjustmentTotal(input, coeff)) > ADJ_CLAMP;
}

export async function calculateAVM(
  supabase: SupabaseClient,
  input: AVMInput
): Promise<AVMResult> {
  // Coefficients + audit are needed by the anchor (for per-comp adjustment and
  // basePrice fallback), so fetch them first, then call fetchAnchor.
  const [coefficients, audit] = await Promise.all([
    fetchCoefficients(supabase, input.cityRegion, input.propertySubType),
    fetchAuditInfo(supabase, input.cityRegion, input.propertySubType),
  ]);
  const anchor = await fetchAnchor(supabase, input, coefficients, audit.basePrice);

  // Peer comp-grid ONLY for feature outliers (the homes the standard estimate
  // mis-prices). undefined → not evaluated → normal path unchanged; AnchorResult
  // → peer-grid; null → too few peers → neighbourhood floor.
  let peer: AnchorResult | null | undefined;
  if (isFeatureOutlier(input, coefficients)) {
    peer = await fetchPeerAnchor(supabase, input, coefficients);
  }

  return estimateFromMarketData(input, {
    anchor,
    r2: audit.r2,
    basePrice: audit.basePrice,
    coefficients,
    n: audit.n,
    peer,
  });
}

/**
 * Pure, deterministic estimate from a listing's features + pre-loaded market
 * data. Identical inputs always yield an identical result; no I/O, no AI.
 */
export function estimateFromMarketData(input: AVMInput, market: AVMMarketData): AVMResult {
  const { anchor } = market;

  // Anchor unavailable: render "estimate unavailable" downstream.
  if (anchor.basis === 'none' || !Number.isFinite(anchor.anchorLevel)) {
    return unavailable(market);
  }

  // Peer/floor branch — engine-independent, so it sits ABOVE the R² gate. Honored
  // only when the async layer evaluated peers (market.peer !== undefined) AND the
  // subject is a genuine feature outlier, so typical homes are never touched (the
  // golden master proves the normal path is frozen).
  if (market.peer !== undefined && isFeatureOutlier(input, market.coefficients)) {
    if (market.peer) return peerEstimate(market.peer, market.r2);
    // peer === null → too few peers anywhere: present the normal number honestly
    // as a neighbourhood FLOOR (relabelled basis, confidence never HIGH).
    const base = normalEstimate(input, market);
    if (base.estimatedValue <= 0) return base; // already suppressed → leave as-is
    return {
      ...base,
      basis: 'floor',
      confidence: base.confidence === CONFIDENCE_HIGH ? CONFIDENCE_MEDIUM : base.confidence,
    };
  }

  return normalEstimate(input, market);
}

/** Today's behaviour: coefficient engine when R² clears the gate, else anchor-only. */
function normalEstimate(input: AVMInput, market: AVMMarketData): AVMResult {
  const { anchor } = market;
  const baseAnchor = Math.exp(anchor.anchorLevel);

  if (market.r2 !== null && market.r2 >= COEFFICIENT_ENGINE_THRESHOLD) {
    return calculateWithCoefficients(baseAnchor, anchor, market.r2, input, market.coefficients);
  }

  // Anchor-only: estimate = anchor; band derived directly from predSD.
  return finish({
    estimatedValue: Math.round(baseAnchor),
    anchorPrice: Math.round(baseAnchor),
    totalAdjustmentPct: 0,
    engineMode: ENGINE_MODE_ANCHOR_ONLY,
    r2Score: market.r2,
    breakdown: blankBreakdown(),
    adjustmentLog: 0,
    anchor,
  });
}

/** Price the subject off the peer comp-grid (basis 'peer'); HIGH gated on peer count. */
function peerEstimate(peer: AnchorResult, r2Score: number | null): AVMResult {
  const peerPrice = Math.exp(peer.anchorLevel);
  return finish(
    {
      estimatedValue: Math.round(peerPrice),
      anchorPrice: Math.round(peerPrice),
      totalAdjustmentPct: 0,
      engineMode: ENGINE_MODE_COEFFICIENT_ADJUSTED,
      r2Score,
      breakdown: blankBreakdown(),
      adjustmentLog: 0,
      anchor: peer, // basis 'peer', band from peer dispersion
    },
    { minPeersForHigh: MIN_PEERS_FOR_HIGH, effectivePeers: peer.nEff }
  );
}

function calculateWithCoefficients(
  baseAnchor: number,
  anchor: AnchorResult,
  r2Score: number,
  input: AVMInput,
  coefficients: CoefficientRow[]
): AVMResult {
  const coeff = new Map(coefficients.map((c) => [c.featureName, c]));

  const breakdown = blankBreakdown();
  let rawTotal = 0;
  for (const c of featureContributions(input, coeff)) {
    rawTotal += c.contribution;
    breakdown[c.key] = Math.round(baseAnchor * c.contribution);
  }

  const total = clamp(rawTotal, -ADJ_CLAMP, ADJ_CLAMP);
  const estimatedValue = Math.round(baseAnchor * Math.exp(total));

  return finish({
    estimatedValue,
    anchorPrice: Math.round(baseAnchor),
    totalAdjustmentPct: Math.exp(total) - 1,
    engineMode: ENGINE_MODE_COEFFICIENT_ADJUSTED,
    r2Score,
    breakdown,
    adjustmentLog: total,
    anchor,
  });
}

/**
 * Apply the symmetric log-space band to the point estimate and derive confidence
 * from its relative half-width. SUPPRESS the estimate entirely when the band is
 * wider than BAND_LOW — we don't publish a number we can't stand behind.
 */
function finish(
  args: {
    estimatedValue: number;
    anchorPrice: number;
    totalAdjustmentPct: number;
    engineMode: AVMResult['engineMode'];
    r2Score: number | null;
    breakdown: AVMAdjustmentBreakdown;
    adjustmentLog: number; // total adjustment in log-space (already clamped)
    anchor: AnchorResult;
  },
  opts?: {
    /** Peer mode: forbid HIGH unless effectivePeers ≥ minPeersForHigh. */
    minPeersForHigh?: number;
    effectivePeers?: number;
  }
): AVMResult {
  const { anchor, adjustmentLog } = args;

  // Band on price: exp(level ± SD) × exp(feature adjustment).
  const lowBand = Math.round(Math.exp(anchor.anchorLevel - anchor.predSD + adjustmentLog));
  const highBand = Math.round(Math.exp(anchor.anchorLevel + anchor.predSD + adjustmentLog));

  // Relative half-width on price ≈ predSD itself in log-space (1-σ band).
  const relHalfWidth = anchor.predSD;
  let confidence: AVMResult['confidence'];
  let estimatedValue = args.estimatedValue;
  let basis: AnchorBasis = anchor.basis;

  if (!Number.isFinite(relHalfWidth) || relHalfWidth > BAND_LOW) {
    // Range too wide to publish — degrade to "unavailable" without erasing the
    // anchor/band (caller can still surface diagnostics).
    confidence = CONFIDENCE_LOW;
    estimatedValue = 0;
    basis = 'none';
  } else {
    if (relHalfWidth < BAND_HIGH) {
      confidence = CONFIDENCE_HIGH;
    } else if (relHalfWidth < BAND_MED) {
      confidence = CONFIDENCE_MEDIUM;
    } else {
      confidence = CONFIDENCE_LOW;
    }
    // A tight band over too few peers is not HIGH — demote it.
    if (
      confidence === CONFIDENCE_HIGH &&
      opts?.minPeersForHigh !== undefined &&
      (opts.effectivePeers ?? 0) < opts.minPeersForHigh
    ) {
      confidence = CONFIDENCE_MEDIUM;
    }
  }

  return {
    estimatedValue,
    anchorPrice: args.anchorPrice,
    totalAdjustmentPct: args.totalAdjustmentPct,
    engineMode: args.engineMode,
    r2Score: args.r2Score,
    breakdown: args.breakdown,
    confidence,
    comps: anchor.comps,
    nEff: Math.round(anchor.nEff * 100) / 100,
    basis,
    lowBand: estimatedValue > 0 ? lowBand : 0,
    highBand: estimatedValue > 0 ? highBand : 0,
    predictiveSD: relHalfWidth,
  };
}

function unavailable(market: AVMMarketData): AVMResult {
  return {
    estimatedValue: 0,
    anchorPrice: 0,
    totalAdjustmentPct: 0,
    engineMode: ENGINE_MODE_ANCHOR_ONLY,
    r2Score: market.r2,
    breakdown: blankBreakdown(),
    confidence: CONFIDENCE_LOW,
    comps: market.anchor.comps,
    nEff: 0,
    basis: 'none',
    lowBand: 0,
    highBand: 0,
    predictiveSD: Infinity,
  };
}

function blankBreakdown(): AVMAdjustmentBreakdown {
  return {
    buildingAreaAdjustment: 0,
    lotWidthAdjustment: 0,
    bedroomsAdjustment: 0,
    bathroomsAdjustment: 0,
    parkingAdjustment: 0,
    interiorAdjustment: 0,
    exteriorAdjustment: 0,
    basementAdjustment: 0,
  };
}
