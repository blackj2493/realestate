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
import { fetchAnchor, type AnchorResult } from './anchorService';
import { fetchAuditInfo } from './auditService';
import { fetchCoefficients, type CoefficientRow } from './matrixService';
import {
  ENGINE_MODE_COEFFICIENT_ADJUSTED,
  ENGINE_MODE_ANCHOR_ONLY,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  CONFIDENCE_LOW,
  COEFFICIENT_ENGINE_THRESHOLD,
  Z_CLAMP,
  ADJ_CLAMP,
  BAND_HIGH,
  BAND_MED,
  BAND_LOW,
} from './types';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

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
  /** Per-feature standardized coefficients (beta/mean/std) for this market. */
  coefficients: CoefficientRow[];
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

  return estimateFromMarketData(input, {
    anchor,
    r2: audit.r2,
    basePrice: audit.basePrice,
    coefficients,
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

  const baseAnchor = Math.exp(anchor.anchorLevel);

  // Gate: coefficient engine only when the market model is accurate enough.
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

function calculateWithCoefficients(
  baseAnchor: number,
  anchor: AnchorResult,
  r2Score: number,
  input: AVMInput,
  coefficients: CoefficientRow[]
): AVMResult {
  const coeff = new Map(coefficients.map((c) => [c.featureName, c]));

  const interiorScore = 6 - input.interiorTier;
  const exteriorScore = 5 - input.exteriorTier;
  const basementScore = 10 - input.basementTier;

  const features: { name: string; value: number | null; key: keyof AVMAdjustmentBreakdown }[] = [
    { name: 'building_area_total', value: input.buildingAreaTotal, key: 'buildingAreaAdjustment' },
    { name: 'lot_width', value: input.lotWidth, key: 'lotWidthAdjustment' },
    { name: 'bedrooms_above_grade', value: input.bedroomsAboveGrade, key: 'bedroomsAdjustment' },
    { name: 'bathrooms_total_integer', value: input.bathroomsTotalInteger, key: 'bathroomsAdjustment' },
    { name: 'parking_total', value: input.parkingTotal, key: 'parkingAdjustment' },
    { name: 'basement_score', value: basementScore, key: 'basementAdjustment' },
    { name: 'interior_score', value: interiorScore, key: 'interiorAdjustment' },
    { name: 'exterior_score', value: exteriorScore, key: 'exteriorAdjustment' },
  ];

  const breakdown = blankBreakdown();
  let total = 0;

  for (const f of features) {
    if (f.value === null) continue;
    const c = coeff.get(f.name);
    if (!c || c.beta === 0 || !(c.std > 0)) continue;
    const z = clamp((f.value - c.mean) / c.std, -Z_CLAMP, Z_CLAMP);
    const contribution = c.beta * z;
    total += contribution;
    breakdown[f.key] = Math.round(baseAnchor * contribution);
  }

  total = clamp(total, -ADJ_CLAMP, ADJ_CLAMP);
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
function finish(args: {
  estimatedValue: number;
  anchorPrice: number;
  totalAdjustmentPct: number;
  engineMode: AVMResult['engineMode'];
  r2Score: number | null;
  breakdown: AVMAdjustmentBreakdown;
  adjustmentLog: number; // total adjustment in log-space (already clamped)
  anchor: AnchorResult;
}): AVMResult {
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
  } else if (relHalfWidth < BAND_HIGH) {
    confidence = CONFIDENCE_HIGH;
  } else if (relHalfWidth < BAND_MED) {
    confidence = CONFIDENCE_MEDIUM;
  } else {
    confidence = CONFIDENCE_LOW;
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
