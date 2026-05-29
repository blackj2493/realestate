/**
 * Maps a raw TRREB listing payload to an AVMInput.
 *
 * Deterministic, no AI (CLAUDE.md §4). Feature extraction MIRRORS the ETL that
 * populates raw_vow_sold (scripts/worker/ingester.ts → numOrNull, no fallback
 * chains), so the live feature distribution matches the per-market Mean/StdDev
 * the model was standardized on. Missing fields stay `null` → the calculator
 * skips them (≡ training mean-imputation, z=0); a genuine `0` is kept.
 *
 * building_area_total is resolved via resolveLivingArea (./livingArea): exact
 * BuildingAreaTotal → measured GLA from room dimensions (when `opts.rooms` is
 * supplied) → calibrated bucket median (when `opts.bucketCalibration` is supplied)
 * → naive LivingAreaRange midpoint. BuildingAreaTotal is ~never filled for houses,
 * so the room-dimension measurement is what keeps large homes from being valued
 * off an inflated 1,500-sqft-wide range bucket.
 *
 * Condition tiers come from the shared scoring module (./conditionScoring), so
 * active/IDX and VOW-sold listings score identically. Tiers only affect the
 * result when the COEFFICIENT_ADJUSTED engine fires (R² >= 0.50).
 */

import type { AVMInput } from './types';
import { deriveInteriorTier, deriveExteriorTier, deriveBasementTier } from './conditionScoring';
import { normalizePropertySubType } from './normalizeType';
import { resolveLivingArea, type ResolveLivingAreaOpts } from './livingArea';

/** Mirror of ingester.ts numOrNull: empty/missing/non-finite → null; else the number. */
function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mapListingToAVMInput(
  payload: Record<string, unknown> | null | undefined,
  opts: ResolveLivingAreaOpts = {}
): AVMInput | null {
  if (!payload) return null;

  const cityRegion = typeof payload.CityRegion === 'string' ? payload.CityRegion.trim() : '';
  const rawPropertySubType =
    typeof payload.PropertySubType === 'string' ? payload.PropertySubType.trim() : '';

  // Anchor + matrix lookups key on these — without them no estimate is possible.
  if (!cityRegion || !rawPropertySubType) return null;

  // Municipality — drives the city-level trend de-staling. Optional: TRREB
  // payloads almost always have it, but if missing the anchor pipeline falls
  // back to treating cityRegion as the trend group.
  const cityRaw = typeof payload.City === 'string' ? payload.City.trim() : '';
  const city = cityRaw || null;

  const lotWidthRaw = numOrNull(payload.LotWidth);
  const lotWidth = lotWidthRaw !== null && lotWidthRaw > 0 ? lotWidthRaw : null;
  const lotDepthRaw = numOrNull(payload.LotDepth);
  const lotDepth = lotDepthRaw !== null && lotDepthRaw > 0 ? lotDepthRaw : null;

  return {
    cityRegion,
    city,
    propertySubType: normalizePropertySubType(rawPropertySubType),
    rawPropertySubType,
    buildingAreaTotal: resolveLivingArea(payload, opts).sqft,
    lotWidth,
    lotDepth,
    bedroomsAboveGrade: numOrNull(payload.BedroomsAboveGrade),
    bathroomsTotalInteger: numOrNull(payload.BathroomsTotalInteger),
    parkingTotal: numOrNull(payload.ParkingTotal),
    interiorTier: deriveInteriorTier(payload),
    exteriorTier: deriveExteriorTier(payload),
    basementTier: deriveBasementTier(payload),
  };
}
