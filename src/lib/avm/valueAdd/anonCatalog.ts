//
// Non-VOW public teaser. Given only the home's own attributes, returns the
// applicable renovation moves + their GTA construction-cost ranges. It runs NO
// AVM, reads NO VOW data, and exposes NO value-add dollars. The blurred hero on
// the reveal is a pure UI placeholder — no number is sent here. This is the
// anonymous half of the soft-gated /api/avm/hidden-equity route.
import { MOVE_CATALOG, isMoveFeasibleForType } from './moveCatalog';
import type { MoveSpec, MoveField, MoveKey } from './types';

/** The only home attributes move-applicability depends on (all non-VOW). */
export interface AnonCatalogInput {
  basementTier: number;
  interiorTier: number;
  exteriorTier: number;
  bathroomsTotalInteger: number;
  bedroomsAboveGrade: number;
  parkingTotal: number;
  buildingAreaTotal: number | null;
  /**
   * Required, not optional: this used to be absent entirely, so the teaser had no
   * idea what kind of home it was describing and offered apartment owners a
   * basement to finish and a detached garage to build. Making it mandatory means
   * a caller cannot quietly drop it again.
   */
  propertySubType: string | null;
}

export interface AnonCatalogItem {
  key: MoveKey;
  label: string;
  costLow: number;
  costTyp: number;
  costHigh: number;
}

export interface AnonCatalogPayload {
  locked: true;
  catalog: AnonCatalogItem[];
}

function currentValue(field: MoveField, input: AnonCatalogInput): number | null {
  switch (field) {
    case 'basementTier': return input.basementTier;
    case 'interiorTier': return input.interiorTier;
    case 'exteriorTier': return input.exteriorTier;
    case 'bathroomsTotalInteger': return input.bathroomsTotalInteger;
    case 'bedroomsAboveGrade': return input.bedroomsAboveGrade;
    case 'parkingTotal': return input.parkingTotal;
    case 'buildingAreaTotal': return input.buildingAreaTotal;
    case 'lotWidth': return null; // no move drives this; treat as unknown
    default: return null;
  }
}

/**
 * A move is shown if applying it would actually improve the home:
 *  - 'add' deltas always change the home (positive increment).
 *  - 'set' deltas (tiers; LOWER tier = better) improve only when current > target,
 *    or when the current value is unknown (null).
 * Mirrors the engine's 'already_present' suppression — without any VOW math.
 */
export function isMoveApplicable(move: MoveSpec, input: AnonCatalogInput): boolean {
  // Feasibility first: no amount of "this would improve the home" matters if the
  // owner physically cannot do it. Same predicate the priced engine uses, so the
  // free teaser and the signed-in report can never contradict each other.
  if (!isMoveFeasibleForType(move, input.propertySubType)) return false;
  return move.deltas.some((d) => {
    if (d.op === 'add') return d.value !== 0;
    const cur = currentValue(d.field, input); // 'set'
    return cur === null || cur > d.value;
  });
}

export function buildAnonCatalog(input: AnonCatalogInput): AnonCatalogPayload {
  const catalog: AnonCatalogItem[] = MOVE_CATALOG
    .filter((m) => isMoveApplicable(m, input))
    .map((m) => ({
      key: m.key,
      label: m.label,
      costLow: m.costLow,
      costTyp: m.costTyp,
      costHigh: m.costHigh,
    }));
  return { locked: true, catalog };
}
