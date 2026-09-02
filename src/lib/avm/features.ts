/**
 * Shared standardized-feature math for the AVM (deterministic, no AI — CLAUDE.md §4).
 *
 * One source of truth for the per-feature log-space contribution β·clamp(z), used by:
 *   • calculator.ts — the subject's adjustment + breakdown + saturation trigger;
 *   • anchorService.ts — the subject premium added to each peer in the comp-grid.
 *
 * Score conventions match the export + ingester:
 *   interior_score = 6 − interiorTier, exterior_score = 5 − exteriorTier,
 *   basement_score = 10 − basementTier.
 */
import type { AVMInput, AVMAdjustmentBreakdown } from './types';
import { Z_CLAMP } from './types';
import type { CoefficientRow } from './matrixService';

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Single registry of the 9 standardized model features. `valueOf` returns the
 * standardized model value from an AVMInput (the SCORE for tier features, via
 * 6−interiorTier / 5−exteriorTier / 10−basementTier), or null when the field is
 * absent. Consumed by featureContributions (AVM) and the valueAdd engine so the
 * two can never disagree on standardization.
 */
export interface FeatureSpec {
  /** AVMInput field a renovation move mutates. */
  inputField: keyof AVMInput;
  /** avm_multiplier_matrix.feature_name. */
  name: string;
  /** AVMAdjustmentBreakdown key. */
  key: keyof AVMAdjustmentBreakdown;
  /** Standardized model value (score for tiers); null = feature absent. */
  valueOf: (input: AVMInput) => number | null;
}

export const FEATURE_SPECS: FeatureSpec[] = [
  { inputField: 'buildingAreaTotal', name: 'building_area_total', key: 'buildingAreaAdjustment', valueOf: (i) => i.buildingAreaTotal },
  { inputField: 'lotWidth', name: 'lot_width', key: 'lotWidthAdjustment', valueOf: (i) => i.lotWidth },
  { inputField: 'bedroomsAboveGrade', name: 'bedrooms_above_grade', key: 'bedroomsAdjustment', valueOf: (i) => i.bedroomsAboveGrade },
  // The plus-room is its own feature, NOT folded into the bedroom count. Held against
  // neighbourhood x sub-type x above-grade beds x banded sqft, a den commands a
  // median 7.12% premium and is the dearer home in 67 of 73 well-sampled strata
  // (Detached 6.47%, Condo Apartment 5.46%, Semi 5.30%, Townhouse 2.76%). Adding it
  // to bedrooms_above_grade instead would price a 2+1 as a 3 bedroom, which is the
  // error the grids were fixed for.
  { inputField: 'bedroomsBelowGrade', name: 'bedrooms_below_grade', key: 'plusRoomAdjustment', valueOf: (i) => i.bedroomsBelowGrade },
  { inputField: 'bathroomsTotalInteger', name: 'bathrooms_total_integer', key: 'bathroomsAdjustment', valueOf: (i) => i.bathroomsTotalInteger },
  { inputField: 'parkingTotal', name: 'parking_total', key: 'parkingAdjustment', valueOf: (i) => i.parkingTotal },
  { inputField: 'basementTier', name: 'basement_score', key: 'basementAdjustment', valueOf: (i) => 10 - i.basementTier },
  { inputField: 'interiorTier', name: 'interior_score', key: 'interiorAdjustment', valueOf: (i) => 6 - i.interiorTier },
  { inputField: 'exteriorTier', name: 'exterior_score', key: 'exteriorAdjustment', valueOf: (i) => 5 - i.exteriorTier },
];

/** The two raw_vow_sold size columns, structurally — so every neutralizer can ask
 *  compSqft without importing anyone else's row type. */
export interface SoldSizeColumns {
  building_area_total: number | null;
  living_area_range?: number | null;
}

/**
 * A comp's square footage, for BOTH neutralization and similarity weighting.
 *
 * `building_area_total` is populated on only 67.4% of sale rows in the 36-month training
 * window. The other 32.6% are not unmeasured homes — 49,819 of them carry the declared
 * band in `living_area_range`, which is the SAME NUMBER wherever both columns exist
 * (171,608 of 180,619). The feed just does not always fill both.
 *
 * Reading the bare column threw that away, and a null does not cost nothing:
 *
 *   • In adjustedLogPrice, a comp with no size is neutralized without its size term, so
 *     whatever made it bigger or smaller than the cohort stays in its adjusted level and
 *     lands in the anchor. A third of the pool pushing the anchor around by their size
 *     is the noise the model exists to remove.
 *   • In the training fit, a null is mean-imputed to z=0 — the textbook cause of
 *     attenuation. Refitting Vellore Village Detached on rows that HAVE the column moves
 *     beta_sqft 0.1033 -> 0.1591 and R2 0.708 -> 0.809. Coalescing gets 0.1322 / 0.744
 *     without discarding a single sale.
 *   • In similarityWeight, a null skips the BW_SQFT term, so a comp of unknown size is
 *     treated as neither near nor far and competes on beds and baths alone.
 *
 * This is the ONLY place the rule is written. The comp RPCs and the trainer do not
 * coalesce; they were changed to SUPPLY both columns (migration 136) and call this. A
 * second COALESCE in SQL would be a second definition, and definitions drift — a comp
 * pool sized differently from the fit is the failure PR #470 fixed, one level down.
 * features.compSqft.test.ts asserts every source still fetches both columns and that
 * nobody has re-implemented the rule.
 *
 * NOT the same question as resolveModelSqft (livingArea.ts). That one asks what the
 * SUBJECT should carry; this asks what a COMP carries. They agree by construction, which
 * is the point.
 */
export function compSqft(c: SoldSizeColumns): number | null {
  const exact = c.building_area_total;
  if (exact !== null && exact !== undefined && exact > 0) return exact;
  const band = c.living_area_range;
  return band !== null && band !== undefined && band > 0 ? band : null;
}

/** Each present feature's standardized contribution β·clamp((x−mean)/std, ±Z_CLAMP). */
export function featureContributions(
  input: AVMInput,
  coeff: Map<string, CoefficientRow>
): { key: keyof AVMAdjustmentBreakdown; contribution: number }[] {
  const out: { key: keyof AVMAdjustmentBreakdown; contribution: number }[] = [];
  for (const spec of FEATURE_SPECS) {
    const value = spec.valueOf(input);
    if (value === null) continue;
    const c = coeff.get(spec.name);
    if (!c || c.beta === 0 || !(c.std > 0)) continue;
    const z = clamp((value - c.mean) / c.std, -Z_CLAMP, Z_CLAMP);
    out.push({ key: spec.key, contribution: c.beta * z });
  }
  return out;
}

/** Subject's total UNCLAMPED log-space adjustment Σ β·clamp(z) over its present features. */
export function subjectAdjustmentTotal(input: AVMInput, coeff: Map<string, CoefficientRow>): number {
  return featureContributions(input, coeff).reduce((a, c) => a + c.contribution, 0);
}
