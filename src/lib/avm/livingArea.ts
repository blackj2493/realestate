/**
 * AVM living-area resolution — deterministic, no AI (CLAUDE.md §4).
 *
 * Picks the best square-footage signal for the AVM, in priority order:
 *   1. exact BuildingAreaTotal           (rare for residential — ~0% coverage)
 *   2. measured GLA from room dimensions (RoomLength×RoomWidth, grossed up)
 *   3. calibrated typical GLA for the listing's (market, sub-type, range bucket)
 *   4. naive LivingAreaRange midpoint    (last resort — what the AVM used before)
 *
 * Why: BuildingAreaTotal is almost never filled for houses, so the model fell back
 * to the midpoint of a ~1,500-sqft-wide MLS range and badly over-valued large
 * homes (a "3500-5000" bucket → an assumed 4,250 sqft). Per-room dimensions are a
 * far sharper, *measured* signal and are fetched live on the detail page.
 */

import type { RoomData } from '@/lib/room-utils';
import { parseLivingAreaRange, SQFT_MIN, SQFT_MAX } from '@/lib/condo/feeStability';

const SQM_TO_SQFT = 10.7639;

/**
 * Listed rooms exclude bathrooms, halls, stairs, closets, the foyer and wall
 * thickness — together ~⅓ of gross living area — so the summed room area is
 * grossed up to approximate GLA. There is no exact-sqft ground truth to fit this
 * against (BuildingAreaTotal is ~never present), so 1.5 is a documented,
 * conservative default. Tunable.
 */
export const GLA_GROSSUP = 1.5;

/**
 * Require a reasonably complete room list before trusting the measured sum — a
 * half-filled list would understate the home and crater the estimate.
 */
export const MIN_DIM_ROOMS = 4;

/**
 * A single room edge this large only makes sense in feet (25 m ≈ 82 ft). Used to
 * auto-detect feet-valued payloads, since RoomData carries no units field (the
 * TRREB feed is metric in practice, but this stays safe if that ever changes).
 */
const FEET_DIMENSION_THRESHOLD = 25;

export type LivingAreaSource = 'exact' | 'rooms' | 'calibrated' | 'range_midpoint' | 'none';

export interface LivingAreaResult {
  sqft: number | null;
  source: LivingAreaSource;
}

export interface BucketCalibration {
  medianGla: number;
  sampleCount: number;
}

export interface ResolveLivingAreaOpts {
  rooms?: RoomData[] | null;
  bucketCalibration?: BucketCalibration | null;
}

function toStr(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '')).join(' ');
  return v == null ? '' : String(v);
}

/** Above grade = anything that isn't a basement / lower / sub level. */
function isAboveGrade(level: unknown): boolean {
  const s = toStr(level).toLowerCase();
  return !(s.includes('basement') || s.includes('lower') || s.includes('sub'));
}

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function inRange(n: number): boolean {
  return n >= SQFT_MIN && n <= SQFT_MAX;
}

/**
 * Sum above-grade room areas (RoomLength × RoomWidth) into raw sqft. Auto-detects
 * meters vs feet from dimension magnitude. Returns null when there aren't enough
 * dimensioned above-grade rooms to trust the measurement.
 */
export function roomSumSqft(
  rooms: RoomData[] | null | undefined
): { rawSqft: number; roomCount: number } | null {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;

  const above: { l: number; w: number }[] = [];
  let maxDim = 0;
  for (const r of rooms) {
    const l = Number(r.RoomLength);
    const w = Number(r.RoomWidth);
    if (!(l > 0) || !(w > 0)) continue;
    maxDim = Math.max(maxDim, l, w);
    if (isAboveGrade(r.RoomLevel)) above.push({ l, w });
  }
  if (above.length < MIN_DIM_ROOMS) return null;

  const unitFactor = maxDim > FEET_DIMENSION_THRESHOLD ? 1 : SQM_TO_SQFT;
  const rawSqft = above.reduce((acc, d) => acc + d.l * d.w * unitFactor, 0);
  return { rawSqft, roomCount: above.length };
}

/**
 * Resolve the living area (sqft) to feed the AVM, following the priority chain.
 * Returns the chosen value plus its `source` for transparency in the UI.
 */
export function resolveLivingArea(
  payload: Record<string, unknown> | null | undefined,
  opts: ResolveLivingAreaOpts = {}
): LivingAreaResult {
  // 1. Exact BuildingAreaTotal.
  const exact = numOrNull(payload?.['BuildingAreaTotal']);
  if (exact !== null && inRange(exact)) return { sqft: exact, source: 'exact' };

  // 2. Measured GLA from room dimensions (allowed to fall below the MLS range).
  const rs = roomSumSqft(opts.rooms);
  if (rs) {
    const gla = Math.round(rs.rawSqft * GLA_GROSSUP);
    if (inRange(gla)) return { sqft: gla, source: 'rooms' };
  }

  // 3. Calibrated typical GLA for this market / sub-type / range bucket.
  const cal = opts.bucketCalibration;
  if (cal && cal.medianGla > 0 && inRange(cal.medianGla)) {
    return { sqft: Math.round(cal.medianGla), source: 'calibrated' };
  }

  // 4. Naive LivingAreaRange midpoint (the pre-fix behaviour).
  const mid = parseLivingAreaRange(payload?.['LivingAreaRange']);
  if (mid !== null && inRange(mid)) return { sqft: mid, source: 'range_midpoint' };

  return { sqft: null, source: 'none' };
}
