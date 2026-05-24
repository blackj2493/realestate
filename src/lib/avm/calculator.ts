/**
 * AVM Calculator — anchor-and-adjust over an interpretable standardized model.
 *
 * estimate = anchor × exp( clamp( Σ beta_i · clamp((x_i − mean_i)/std_i, ±Z), ±ADJ ) )
 *
 * A typical home (every present feature at its market mean → all z=0) returns
 * exactly the anchor. Per-feature beta/mean/std come from the offline RidgeCV fit
 * (avm_multiplier_matrix); they are constants, so this is deterministic arithmetic
 * with no AI at request time (CLAUDE.md §4).
 *
 * Score conventions (must match the export + ingester):
 *   interior_score = 6 − interiorTier,  exterior_score = 5 − exteriorTier,
 *   basement_score = 10 − basementTier.
 *
 * Gate: coefficients apply only when audit R² ≥ 0.50; otherwise anchor-only.
 * Anchor: live 90-day median when comps ≥ MIN_ANCHOR_COMPS, else Base_Price,
 * else estimate unavailable.
 */

import type { AVMInput, AVMResult, AVMAdjustmentBreakdown } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAnchor } from './anchorService';
import { fetchAuditInfo } from './auditService';
import { fetchCoefficients } from './matrixService';
import {
  ENGINE_MODE_COEFFICIENT_ADJUSTED,
  ENGINE_MODE_ANCHOR_ONLY,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  CONFIDENCE_LOW,
  COEFFICIENT_ENGINE_THRESHOLD,
  HIGH_CONFIDENCE_THRESHOLD,
  Z_CLAMP,
  ADJ_CLAMP,
  MIN_ANCHOR_COMPS,
} from './types';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export async function calculateAVM(
  supabase: SupabaseClient,
  input: AVMInput
): Promise<AVMResult> {
  // Anchor and audit are independent → fetch in parallel.
  const [anchorRes, audit] = await Promise.all([
    fetchAnchor(supabase, input.cityRegion, input.propertySubType, input.rawPropertySubType),
    fetchAuditInfo(supabase, input.cityRegion, input.propertySubType),
  ]);

  // Anchor selection ladder: live median (enough comps) → Base_Price → unavailable.
  let anchor: number | null = null;
  let usedFallback = false;
  if (anchorRes.anchor !== null && anchorRes.comps >= MIN_ANCHOR_COMPS) {
    anchor = anchorRes.anchor;
  } else if (audit.basePrice !== null) {
    anchor = audit.basePrice;
    usedFallback = true;
  }

  if (anchor === null) {
    return {
      estimatedValue: 0,
      anchorPrice: 0,
      totalAdjustmentPct: 0,
      engineMode: ENGINE_MODE_ANCHOR_ONLY,
      r2Score: audit.r2,
      breakdown: blankBreakdown(),
      confidence: CONFIDENCE_LOW,
    };
  }

  // Gate: coefficient engine only when the market model is accurate enough.
  if (audit.r2 !== null && audit.r2 >= COEFFICIENT_ENGINE_THRESHOLD) {
    return calculateWithCoefficients(supabase, anchor, audit.r2, usedFallback, input);
  }

  return {
    estimatedValue: anchor,
    anchorPrice: anchor,
    totalAdjustmentPct: 0,
    engineMode: ENGINE_MODE_ANCHOR_ONLY,
    r2Score: audit.r2,
    breakdown: blankBreakdown(),
    confidence: audit.r2 !== null ? CONFIDENCE_MEDIUM : CONFIDENCE_LOW,
  };
}

async function calculateWithCoefficients(
  supabase: SupabaseClient,
  anchor: number,
  r2Score: number,
  usedFallback: boolean,
  input: AVMInput
): Promise<AVMResult> {
  const coefficients = await fetchCoefficients(
    supabase,
    input.cityRegion,
    input.propertySubType
  );

  const coeff = new Map(coefficients.map((c) => [c.featureName, c]));

  // Live feature values. Condition is in SCORE space; counts/continuous are raw.
  // null → field absent → skip (≡ training mean-imputation, z=0).
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
    // First-order $ attribution (sums ≈ the total adjustment for small values).
    breakdown[f.key] = Math.round(anchor * contribution);
  }

  total = clamp(total, -ADJ_CLAMP, ADJ_CLAMP);
  const estimatedValue = Math.round(anchor * Math.exp(total));

  const confidence = usedFallback
    ? CONFIDENCE_MEDIUM
    : r2Score >= HIGH_CONFIDENCE_THRESHOLD
    ? CONFIDENCE_HIGH
    : CONFIDENCE_MEDIUM;

  return {
    estimatedValue,
    anchorPrice: anchor,
    totalAdjustmentPct: Math.exp(total) - 1,
    engineMode: ENGINE_MODE_COEFFICIENT_ADJUSTED,
    r2Score,
    breakdown,
    confidence,
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
