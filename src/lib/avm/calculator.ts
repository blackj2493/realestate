/**
 * AVM Calculator — Core Two-Tier Rule
 * 
 * Implements the decision tree:
 * - Condition A (R² >= 0.50): Apply coefficient multipliers
 * - Condition B (R² < 0.50 or missing): Return anchor only (fallback)
 * 
 * Score Conversion Logic:
 * - Interior score = 6 - interiorTier (Tier 1 → score 5, Tier 5 → score 1)
 * - Exterior score = 5 - exteriorTier (Tier 1 → score 4, Tier 5 → score 0)
 * - Basement score = 10 - basementTier (Tier 1 → score 9, Tier 9 → score 1)
 */

import type { AVMInput, AVMResult, AVMAdjustmentBreakdown } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAnchorPrice } from './anchorService';
import { fetchR2Score } from './auditService';
import { fetchCoefficients, type CoefficientRow } from './matrixService';
import {
  ENGINE_MODE_COEFFICIENT_ADJUSTED,
  ENGINE_MODE_ANCHOR_ONLY,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  CONFIDENCE_LOW,
  COEFFICIENT_ENGINE_THRESHOLD,
  HIGH_CONFIDENCE_THRESHOLD,
} from './types';

const THRESHOLD = COEFFICIENT_ENGINE_THRESHOLD;
const HIGH_CONF = HIGH_CONFIDENCE_THRESHOLD;

export async function calculateAVM(
  supabase: SupabaseClient,
  input: AVMInput
): Promise<AVMResult> {
  // STEP 1: Fetch anchor price (always needed)
  const anchorPrice = await fetchAnchorPrice(
    supabase,
    input.cityRegion,
    input.propertySubType
  );

  if (!anchorPrice) {
    return {
      estimatedValue: 0,
      anchorPrice: 0,
      totalAdjustmentPct: 0,
      engineMode: ENGINE_MODE_ANCHOR_ONLY,
      r2Score: null,
      breakdown: blankBreakdown(),
      confidence: CONFIDENCE_LOW,
    };
  }

  // STEP 2: Fetch R² score for gating decision
  const r2Score = await fetchR2Score(
    supabase,
    input.cityRegion,
    input.propertySubType
  );

  // STEP 3: Apply Two-Tier Rule
  if (r2Score !== null && r2Score >= THRESHOLD) {
    return calculateWithCoefficients(supabase, anchorPrice, r2Score, input);
  } else {
    return {
      estimatedValue: anchorPrice,
      anchorPrice,
      totalAdjustmentPct: 0,
      engineMode: ENGINE_MODE_ANCHOR_ONLY,
      r2Score,
      breakdown: blankBreakdown(),
      confidence: r2Score !== null ? CONFIDENCE_MEDIUM : CONFIDENCE_LOW,
    };
  }
}

async function calculateWithCoefficients(
  supabase: SupabaseClient,
  anchorPrice: number,
  r2Score: number,
  input: AVMInput
): Promise<AVMResult> {
  const coefficients = await fetchCoefficients(
    supabase,
    input.cityRegion,
    input.propertySubType
  );

  // Convert tiers to model scores (matches the Python extraction logic)
  const interiorScore = 6 - input.interiorTier;
  const exteriorScore = 5 - input.exteriorTier;
  const basementScore = 10 - input.basementTier;

  // Helper: get the per-unit coefficient for a feature
  const getCoefficient = (feature: string): number => {
    const row = coefficients.find((c) => c.featureName === feature);
    return row?.multiplier ?? 0;
  };

  // MULTIPLY the user's input by the feature's coefficient
  const bedroomMult = getCoefficient('bedrooms_above_grade') * input.bedroomsAboveGrade;
  const bathroomMult = getCoefficient('bathrooms_total_integer') * input.bathroomsTotalInteger;
  const parkingMult = getCoefficient('parking_total') * input.parkingTotal;
  const interiorMult = getCoefficient('interior_score') * interiorScore;
  const exteriorMult = getCoefficient('exterior_score') * exteriorScore;
  const basementMult = getCoefficient('basement_score') * basementScore;

  const totalMultiplier =
    bedroomMult + bathroomMult + parkingMult + interiorMult + exteriorMult + basementMult;

  const breakdown: AVMAdjustmentBreakdown = {
    bedroomsAdjustment: Math.round(anchorPrice * bedroomMult),
    bathroomsAdjustment: Math.round(anchorPrice * bathroomMult),
    parkingAdjustment: Math.round(anchorPrice * parkingMult),
    interiorAdjustment: Math.round(anchorPrice * interiorMult),
    exteriorAdjustment: Math.round(anchorPrice * exteriorMult),
    basementAdjustment: Math.round(anchorPrice * basementMult),
  };

  const estimatedValue = Math.round(anchorPrice * (1 + totalMultiplier));

  const confidence = r2Score >= HIGH_CONF ? CONFIDENCE_HIGH : CONFIDENCE_MEDIUM;

  return {
    estimatedValue,
    anchorPrice,
    totalAdjustmentPct: totalMultiplier,
    engineMode: ENGINE_MODE_COEFFICIENT_ADJUSTED,
    r2Score,
    breakdown,
    confidence,
  };
}

function blankBreakdown(): AVMAdjustmentBreakdown {
  return {
    bedroomsAdjustment: 0,
    bathroomsAdjustment: 0,
    parkingAdjustment: 0,
    interiorAdjustment: 0,
    exteriorAdjustment: 0,
    basementAdjustment: 0,
  };
}