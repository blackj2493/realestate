/**
 * Maps a raw TRREB listing payload to an AVMInput.
 *
 * Deterministic, no AI (CLAUDE.md §4). Feature extraction MIRRORS the ETL that
 * populates raw_vow_sold (scripts/worker/ingester.ts → numOrNull, no fallback
 * chains), so the live feature distribution matches the per-market Mean/StdDev
 * the model was standardized on. Missing fields stay `null` → the calculator
 * skips them (≡ training mean-imputation, z=0); a genuine `0` is kept.
 *
 * building_area_total is resolved via resolveModelSqft (./livingArea): exact
 * BuildingAreaTotal → LivingAreaRange midpoint. That is the COMPS' scale, and the
 * whole point of this mapper is that the subject reaches the coefficients measured
 * the way the training rows were. It used to call resolveLivingArea, whose sharper
 * room-dimension measurement lives on a different scale and sheared the estimate
 * with size — see the note on resolveModelSqft for the numbers.
 *
 * Use resolveLivingArea, not this, for anything a person reads (GLA, $/sqft).
 *
 * Condition tiers come from the shared scoring module (./conditionScoring), so
 * active/IDX and VOW-sold listings score identically. Tiers only affect the
 * result when the COEFFICIENT_ADJUSTED engine fires (R² >= 0.50).
 */

import type { AVMInput } from './types';
import { deriveInteriorTier, deriveExteriorTier, deriveBasementTier } from './conditionScoring';
import { normalizePropertySubType, fsaOf } from './normalizeType';
import { resolveModelSqft } from './livingArea';

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

  // Municipality — drives the city-level trend de-staling, and (with the postal FSA)
  // the comp cohort when CityRegion is absent.
  const cityRaw = typeof payload.City === 'string' ? payload.City.trim() : '';
  const city = cityRaw || null;
  const postalCode = typeof payload.PostalCode === 'string' ? payload.PostalCode.trim() : null;

  // Sub-type is non-negotiable: every comp pool is filtered by it.
  if (!rawPropertySubType) return null;

  // CityRegion is NOT. It used to be — this returned null without it, on the reasoning
  // that "anchor + matrix lookups key on these". That silently zeroed whole
  // municipalities: the TRREB feed ships no CityRegion for any of Waterloo Region or
  // Brantford, so 4,155 active listings never had an estimate ATTEMPTED (measured: 0
  // of 4,155 had a value) even though Kitchener alone has 2,433 sales on file from the
  // last year. fetchAnchor now anchors those on the postal FSA instead, so the only
  // real requirement is that SOME geographic key survives.
  if (!cityRegion && !(city && fsaOf(postalCode))) return null;

  const lotWidthRaw = numOrNull(payload.LotWidth);
  const lotWidth = lotWidthRaw !== null && lotWidthRaw > 0 ? lotWidthRaw : null;
  const lotDepthRaw = numOrNull(payload.LotDepth);
  const lotDepth = lotDepthRaw !== null && lotDepthRaw > 0 ? lotDepthRaw : null;

  return {
    cityRegion,
    city,
    propertySubType: normalizePropertySubType(rawPropertySubType),
    rawPropertySubType,
    buildingAreaTotal: resolveModelSqft(payload).sqft,
    lotWidth,
    lotDepth,
    bedroomsAboveGrade: numOrNull(payload.BedroomsAboveGrade),
    bedroomsBelowGrade: numOrNull(payload.BedroomsBelowGrade),
    bathroomsTotalInteger: numOrNull(payload.BathroomsTotalInteger),
    parkingTotal: numOrNull(payload.ParkingTotal),
    interiorTier: deriveInteriorTier(payload),
    exteriorTier: deriveExteriorTier(payload),
    basementTier: deriveBasementTier(payload),
    // Full postal for hierarchical geo comp weighting (the active listing payload
    // carries the full 6-char code). Absent → geo weighting is a no-op for this subject.
    // Its FSA is also the comp-cohort key when CityRegion is blank (see the guard above).
    postalCode,
  };
}
