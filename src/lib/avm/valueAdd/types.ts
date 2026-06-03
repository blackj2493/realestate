// src/lib/avm/valueAdd/types.ts
import type { AVMInput } from '../types';

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
}

export type MoveStatus = 'priced' | 'suppressed';
export type SuppressReason =
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
  /** GROSS joint value-add in dollars (capped joint, BEFORE renovation costs).
   *  Always ≥ headlineUpside. 0 in the unavailable report. */
  headlineUpsideGross: number;
  /** NET of renovation costs: joint value-add of the best non-overlapping
   *  positive-payback moves − their costs. May be 0 while valueAddScore > 0. */
  headlineUpside: number;
  /** GROSS unlockable-equity index (0–100), BEFORE costs:
   *  min(100, round((jointValue / P0) · SCORE_K)). Not net of renovation spend. */
  valueAddScore: number;
  moves: ValueAddMove[];
  neighbourhoodInsight: string;
  basis: string;
  disclaimer: string;
}
