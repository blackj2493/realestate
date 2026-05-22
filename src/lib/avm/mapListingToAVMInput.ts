/**
 * Maps a raw TRREB listing payload to an AVMInput.
 *
 * Deterministic, no AI (CLAUDE.md §4). Condition tiers are derived from
 * structured fields by the shared scoring module (./conditionScoring), so
 * active/IDX listings and VOW-sold listings are scored identically. Tiers only
 * affect the result when the COEFFICIENT_ADJUSTED engine fires (R² >= 0.50); in
 * ANCHOR_ONLY markets they are ignored entirely.
 */

import type { AVMInput } from './types';
import { deriveInteriorTier, deriveExteriorTier, deriveBasementTier } from './conditionScoring';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), 0, 10) : 0;
}

export function mapListingToAVMInput(
  payload: Record<string, unknown> | null | undefined
): AVMInput | null {
  if (!payload) return null;

  const cityRegion = typeof payload.CityRegion === 'string' ? payload.CityRegion.trim() : '';
  const propertySubType =
    typeof payload.PropertySubType === 'string' ? payload.PropertySubType.trim() : '';

  // Anchor lookup keys on these — without them no estimate is possible.
  if (!cityRegion || !propertySubType) return null;

  const bedroomsAboveGrade = toCount(payload.BedroomsAboveGrade ?? payload.BedroomsTotal);
  const bathroomsTotalInteger = toCount(payload.BathroomsTotalInteger);
  const parkingTotal = toCount(payload.ParkingTotal ?? payload.CoveredSpaces);

  return {
    cityRegion,
    propertySubType,
    bedroomsAboveGrade,
    bathroomsTotalInteger,
    parkingTotal,
    interiorTier: deriveInteriorTier(payload),
    exteriorTier: deriveExteriorTier(payload),
    basementTier: deriveBasementTier(payload),
  };
}
