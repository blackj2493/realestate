/**
 * Maps a raw TRREB listing payload to an AVMInput.
 *
 * Deterministic, no AI (CLAUDE.md §4). Feature extraction MIRRORS the ETL that
 * populates raw_vow_sold (scripts/worker/ingester.ts → numOrNull, no fallback
 * chains), so the live feature distribution matches the per-market Mean/StdDev
 * the model was standardized on. Missing fields stay `null` → the calculator
 * skips them (≡ training mean-imputation, z=0); a genuine `0` is kept.
 *
 * One deliberate, flagged extension: building_area_total falls back to the
 * LivingAreaRange bucket midpoint (via resolveSqft) when BuildingAreaTotal is
 * absent — a coverage win (critical for condos) on the same sqft scale as the
 * trained column.
 *
 * Condition tiers come from the shared scoring module (./conditionScoring), so
 * active/IDX and VOW-sold listings score identically. Tiers only affect the
 * result when the COEFFICIENT_ADJUSTED engine fires (R² >= 0.50).
 */

import type { AVMInput } from './types';
import { deriveInteriorTier, deriveExteriorTier, deriveBasementTier } from './conditionScoring';
import { normalizePropertySubType } from './normalizeType';
import { resolveSqft } from '@/lib/condo/feeStability';

/** Mirror of ingester.ts numOrNull: empty/missing/non-finite → null; else the number. */
function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mapListingToAVMInput(
  payload: Record<string, unknown> | null | undefined
): AVMInput | null {
  if (!payload) return null;

  const cityRegion = typeof payload.CityRegion === 'string' ? payload.CityRegion.trim() : '';
  const rawPropertySubType =
    typeof payload.PropertySubType === 'string' ? payload.PropertySubType.trim() : '';

  // Anchor + matrix lookups key on these — without them no estimate is possible.
  if (!cityRegion || !rawPropertySubType) return null;

  const lotWidthRaw = numOrNull(payload.LotWidth);
  const lotWidth = lotWidthRaw !== null && lotWidthRaw > 0 ? lotWidthRaw : null;

  return {
    cityRegion,
    propertySubType: normalizePropertySubType(rawPropertySubType),
    rawPropertySubType,
    buildingAreaTotal: resolveSqft(payload),
    lotWidth,
    bedroomsAboveGrade: numOrNull(payload.BedroomsAboveGrade),
    bathroomsTotalInteger: numOrNull(payload.BathroomsTotalInteger),
    parkingTotal: numOrNull(payload.ParkingTotal),
    interiorTier: deriveInteriorTier(payload),
    exteriorTier: deriveExteriorTier(payload),
    basementTier: deriveBasementTier(payload),
  };
}
