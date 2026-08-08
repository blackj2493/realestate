// src/lib/avm/valueAdd/types.ts
import type { AVMInput } from '../types';
import type { NormalizedType } from '../normalizeType';

export type MoveKey =
  | 'finish_basement'
  | 'legal_suite'
  | 'add_bathroom'
  | 'add_bedroom'
  | 'build_addition'
  | 'interior_excellent'
  | 'add_parking'
  | 'build_garage'
  | 'curb_appeal';

/** AVMInput numeric fields a move may mutate. */
export type MoveField = Extract<
  keyof AVMInput,
  | 'buildingAreaTotal' | 'lotWidth' | 'bedroomsAboveGrade'
  | 'bathroomsTotalInteger' | 'parkingTotal'
  | 'basementTier' | 'interiorTier' | 'exteriorTier'
>;

/** One field change a move applies. 'set' = absolute target (tiers); 'add' = increment. */
export interface FeatureDelta {
  field: MoveField;
  op: 'set' | 'add';
  value: number;
}

export interface MoveSpec {
  key: MoveKey;
  label: string;
  deltas: FeatureDelta[];
  /** matrix feature_name(s) whose beta drives this move's value (used for gating). */
  drivingFeatures: string[];
  costLow: number;
  costTyp: number;
  costHigh: number;
  /** sane absolute value-add ceiling (CAD) for the magnitude cap. */
  capHigh: number;
  /**
   * Dwelling types where this move is PHYSICALLY OR LEGALLY IMPOSSIBLE, regardless
   * of what the coefficients say. This is a feasibility gate, not a statistical one:
   * the engine's other gates ask "is this beta trustworthy?", which is a different
   * question from "can the owner actually do this?". A condo cohort happens to carry
   * a degenerate basement column, so basement moves were being suppressed by
   * coincidence — but building_area_total is perfectly healthy for condos, so
   * "Build an addition (~400 sq ft)" priced and displayed on apartments.
   */
  infeasibleFor?: readonly NormalizedType[];
}

export type MoveStatus = 'priced' | 'suppressed';
export type SuppressReason =
  /** The owner cannot do this to this kind of home (see MoveSpec.infeasibleFor). */
  | 'not_applicable_to_type'
  | 'negative_beta'
  | 'placeholder'
  | 'low_r2'
  | 'thin_cohort'
  | 'at_ceiling'
  | 'null_baseline'
  | 'already_present'
  | 'no_estimate';

export interface ValueAddMove {
  key: MoveKey;
  label: string;
  status: MoveStatus;
  suppressReason?: SuppressReason;
  valueAddLow: number;
  valueAddTyp: number;
  valueAddHigh: number;
  costLow: number;
  costTyp: number;
  costHigh: number;
  netGainTyp: number;
  paybackRatio: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** True for the greedy, non-overlapping, positive-payback set the card recommends
   *  and the headline sums. Set in buildValueAddReport; false on every other move. */
  recommended: boolean;
}

export interface ValueAddReport {
  cityRegion: string;
  propertySubType: string;
  /** P0 — the home's own AVM estimate (0 when unavailable). */
  subjectEstimate: number;
  /** GROSS additive sum of the recommended moves' value-adds (each per-move capped),
   *  BEFORE renovation costs. Always ≥ headlineUpside. 0 in the unavailable report. */
  headlineUpsideGross: number;
  /** NET of renovation costs: the recommended moves' summed value-add − their costs.
   *  May be 0 while valueAddScore > 0. */
  headlineUpside: number;
  /** GROSS unlockable-equity index (0–100), BEFORE costs:
   *  min(100, round((grossSum / P0) · SCORE_K)), grossSum = Σ valueAddTyp of recommended moves. */
  valueAddScore: number;
  /** Overall renovation-model confidence (from cohort R²): HIGH ≥0.70, MEDIUM ≥0.50, LOW below. */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  moves: ValueAddMove[];
  neighbourhoodInsight: string;
  /** Closed sales the cohort's coefficients were fitted on (null when untrained). */
  salesAnalyzed: number | null;
  basis: string;
  disclaimer: string;
}
