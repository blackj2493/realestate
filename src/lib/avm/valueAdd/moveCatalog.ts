// src/lib/avm/valueAdd/moveCatalog.ts
import type { MoveSpec } from './types';
import { normalizePropertySubType, type NormalizedType } from '../normalizeType';

/**
 * Moves impossible in an apartment: there is no basement to finish or convert, the
 * envelope cannot be extended, nothing can be built on land the owner doesn't hold,
 * and the exterior is a common element belonging to the corporation.
 *
 * Deliberately NOT applied to Townhouse. normalizePropertySubType() collapses both
 * "Condo Townhouse" and freehold "Att/Row/Townhouse" to 'Townhouse' (it tests 'town'
 * before 'condo'), so we cannot tell them apart here — and freehold towns routinely
 * do have basements. Gating them would wrongly strip real moves from the more common
 * case. Only gate what is unambiguous.
 */
const CONDO_IMPOSSIBLE = ['Condo Apartment'] as const satisfies readonly NormalizedType[];

/**
 * Renovation moves as achievable tier transitions / physical bundles mapped to the
 * 8 model features. Costs are 2024–2026 GTA contractor benchmarks (CAD); capHigh is
 * a sane upper bound for the value-add a single move can plausibly add (the trust
 * layer floors at 0 and applies %-of-home + $/sqft caps on top). Tier targets use
 * the score conventions: lower basement/interior/exterior tier = better.
 */
export const MOVE_CATALOG: MoveSpec[] = [
  {
    key: 'finish_basement',
    label: 'Finish the basement',
    deltas: [{ field: 'basementTier', op: 'set', value: 2 }], // → basement_score 8 (solid finish)
    drivingFeatures: ['basement_score'],
    costLow: 25000, costTyp: 40000, costHigh: 65000,
    capHigh: 150000,
    infeasibleFor: CONDO_IMPOSSIBLE,
  },
  {
    key: 'legal_suite',
    label: 'Add a legal basement suite',
    deltas: [
      { field: 'basementTier', op: 'set', value: 1 }, // → basement_score 9 (top)
      { field: 'bathroomsTotalInteger', op: 'add', value: 1 },
    ],
    drivingFeatures: ['basement_score', 'bathrooms_total_integer'],
    costLow: 50000, costTyp: 75000, costHigh: 120000,
    capHigh: 220000,
    infeasibleFor: CONDO_IMPOSSIBLE,
  },
  {
    key: 'add_bathroom',
    label: 'Add a full bathroom',
    deltas: [{ field: 'bathroomsTotalInteger', op: 'add', value: 1 }],
    drivingFeatures: ['bathrooms_total_integer'],
    costLow: 8000, costTyp: 14000, costHigh: 22000,
    capHigh: 60000,
  },
  {
    key: 'add_bedroom',
    label: 'Add a bedroom',
    deltas: [{ field: 'bedroomsAboveGrade', op: 'add', value: 1 }],
    drivingFeatures: ['bedrooms_above_grade'],
    costLow: 6000, costTyp: 12000, costHigh: 22000,
    capHigh: 50000,
  },
  {
    key: 'build_addition',
    label: 'Build an addition (~400 sq ft)',
    deltas: [{ field: 'buildingAreaTotal', op: 'add', value: 400 }],
    drivingFeatures: ['building_area_total'],
    costLow: 80000, costTyp: 130000, costHigh: 200000,
    capHigh: 200000,
    infeasibleFor: CONDO_IMPOSSIBLE,
  },
  {
    key: 'interior_excellent',
    label: 'Renovate interior to excellent',
    deltas: [{ field: 'interiorTier', op: 'set', value: 1 }], // → interior_score 5 (top)
    drivingFeatures: ['interior_score'],
    costLow: 30000, costTyp: 65000, costHigh: 110000,
    capHigh: 120000,
  },
  {
    key: 'add_parking',
    label: 'Add a parking space',
    deltas: [{ field: 'parkingTotal', op: 'add', value: 1 }],
    drivingFeatures: ['parking_total'],
    costLow: 2500, costTyp: 5000, costHigh: 10000,
    capHigh: 30000,
  },
  {
    key: 'build_garage',
    label: 'Build a detached garage',
    deltas: [{ field: 'parkingTotal', op: 'add', value: 2 }],
    drivingFeatures: ['parking_total'],
    costLow: 22000, costTyp: 38000, costHigh: 60000,
    capHigh: 90000,
    infeasibleFor: CONDO_IMPOSSIBLE,
  },
  {
    key: 'curb_appeal',
    label: 'Curb-appeal / exterior upgrade',
    deltas: [{ field: 'exteriorTier', op: 'set', value: 2 }], // → exterior_score 3
    drivingFeatures: ['exterior_score'],
    costLow: 3000, costTyp: 10000, costHigh: 25000,
    capHigh: 60000,
    infeasibleFor: CONDO_IMPOSSIBLE, // the facade is a common element, not the owner's
  },
];

/**
 * Can the owner of this kind of home actually carry this move out?
 *
 * The single feasibility check, shared by BOTH halves of the soft gate — the
 * anonymous catalog and the priced engine — so the two can never disagree about
 * what a condo owner is allowed to be shown. Unknown/blank types pass: an
 * unrecognised spelling should lose no moves, since the failure mode we care about
 * is showing an impossible one, not hiding a possible one.
 */
export function isMoveFeasibleForType(
  move: MoveSpec,
  propertySubType: string | null | undefined,
): boolean {
  if (!move.infeasibleFor?.length) return true;
  const normalized = normalizePropertySubType(propertySubType);
  if (!normalized) return true;
  return !move.infeasibleFor.includes(normalized as NormalizedType);
}
