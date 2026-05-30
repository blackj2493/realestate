// src/lib/avm/valueAdd/moveCatalog.ts
import type { MoveSpec } from './types';

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
    costLow: 32000, costTyp: 52000, costHigh: 80000,
    capHigh: 150000,
  },
  {
    key: 'legal_suite',
    label: 'Add a legal basement suite',
    deltas: [
      { field: 'basementTier', op: 'set', value: 1 }, // → basement_score 9 (top)
      { field: 'bathroomsTotalInteger', op: 'add', value: 1 },
    ],
    drivingFeatures: ['basement_score', 'bathrooms_total_integer'],
    costLow: 60000, costTyp: 95000, costHigh: 180000,
    capHigh: 220000,
  },
  {
    key: 'add_bathroom',
    label: 'Add a full bathroom',
    deltas: [{ field: 'bathroomsTotalInteger', op: 'add', value: 1 }],
    drivingFeatures: ['bathrooms_total_integer'],
    costLow: 12000, costTyp: 20000, costHigh: 35000,
    capHigh: 60000,
  },
  {
    key: 'add_bedroom',
    label: 'Add a bedroom',
    deltas: [{ field: 'bedroomsAboveGrade', op: 'add', value: 1 }],
    drivingFeatures: ['bedrooms_above_grade'],
    costLow: 8000, costTyp: 18000, costHigh: 35000,
    capHigh: 50000,
  },
  {
    key: 'build_addition',
    label: 'Build an addition (~400 sq ft)',
    deltas: [{ field: 'buildingAreaTotal', op: 'add', value: 400 }],
    drivingFeatures: ['building_area_total'],
    costLow: 80000, costTyp: 140000, costHigh: 240000,
    capHigh: 200000,
  },
  {
    key: 'interior_excellent',
    label: 'Renovate interior to excellent',
    deltas: [{ field: 'interiorTier', op: 'set', value: 1 }], // → interior_score 5 (top)
    drivingFeatures: ['interior_score'],
    costLow: 40000, costTyp: 90000, costHigh: 160000,
    capHigh: 120000,
  },
  {
    key: 'add_parking',
    label: 'Add a parking space',
    deltas: [{ field: 'parkingTotal', op: 'add', value: 1 }],
    drivingFeatures: ['parking_total'],
    costLow: 2500, costTyp: 6000, costHigh: 12000,
    capHigh: 30000,
  },
  {
    key: 'build_garage',
    label: 'Build a detached garage',
    deltas: [{ field: 'parkingTotal', op: 'add', value: 2 }],
    drivingFeatures: ['parking_total'],
    costLow: 42000, costTyp: 70000, costHigh: 120000,
    capHigh: 90000,
  },
  {
    key: 'curb_appeal',
    label: 'Curb-appeal / exterior upgrade',
    deltas: [{ field: 'exteriorTier', op: 'set', value: 2 }], // → exterior_score 3
    drivingFeatures: ['exterior_score'],
    costLow: 5000, costTyp: 20000, costHigh: 80000,
    capHigh: 60000,
  },
];
