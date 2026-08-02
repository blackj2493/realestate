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
 * Median room edge above which METRES is physically impossible — 20 m is a 66 ft
 * room, and a whole home whose *typical* room is that size is not a home.
 *
 * This is a safety valve for a hypothetical undeclared-imperial listing, NOT a
 * classifier. Calibrated against the feed's own `RoomLengthWidthUnits` on 250
 * ground-truth listings (`scripts/admin/calibrateRoomUnits.ts`):
 *
 *   always metric      100.0%  correct
 *   median  > 20        99.6%  (1 wrong)
 *   median  > 12        94.8%
 *   max     > 25        53.6%  <- the rule this replaces
 *
 * Every single error, in every rule, is metric-read-as-feet — the damaging
 * direction, because it divides the listing's living area by 10.76.
 */
const IMPLAUSIBLE_METRIC_MEDIAN = 20;

export type DimensionUnit = 'meters' | 'feet';

/** How the unit was arrived at — surfaced so a wrong call is traceable. */
export type DimensionUnitSource = 'declared' | 'default' | 'implausible-as-metric';

/**
 * Which unit a listing's room dimensions are in.
 *
 * The feed declares this in `RoomLengthWidthUnits`, populated on roughly a fifth
 * of rooms and consistent across a listing when present, so a single declaration
 * settles the whole listing. Absent that, metres is the answer: of 250 listings
 * that DO declare, 250 declare metres and none declare feet.
 *
 * What this replaces was `max(edge) > 25 => feet`, evaluated across every room in
 * the listing. Because it keyed on the MAXIMUM, one outlier dimension flipped the
 * entire listing and divided its living area by 10.76 — it scored 53.6% against
 * the declared truth, i.e. worse than never guessing at all, and it was wrong on
 * 1,109 GLA-eligible listings in production.
 */
export function resolveDimensionUnit(
  rooms: RoomData[] | null | undefined
): { unit: DimensionUnit; source: DimensionUnitSource } {
  const declared = new Set(
    (rooms ?? [])
      .map((r) => String(r.RoomLengthWidthUnits ?? '').trim().toLowerCase())
      .filter(Boolean)
  );
  // Exactly one declared value = authoritative. Mixed values within one listing
  // are self-contradictory, so they fall through rather than pick a side.
  if (declared.size === 1) {
    const v = [...declared][0];
    if (v.startsWith('m')) return { unit: 'meters', source: 'declared' };
    if (v.startsWith('f')) return { unit: 'feet', source: 'declared' };
  }

  const edges = (rooms ?? [])
    .map((r) => Math.max(Number(r.RoomLength) || 0, Number(r.RoomWidth) || 0))
    .filter((e) => e > 0)
    .sort((a, b) => a - b);
  if (edges.length === 0) return { unit: 'meters', source: 'default' };

  // Median, not max: no single row can move it.
  const mid = edges.length >> 1;
  const medianEdge = edges.length % 2 ? edges[mid] : (edges[mid - 1] + edges[mid]) / 2;

  return medianEdge > IMPLAUSIBLE_METRIC_MEDIAN
    ? { unit: 'feet', source: 'implausible-as-metric' }
    : { unit: 'meters', source: 'default' };
}

/**
 * TRREB sometimes sends `RoomLength = 1, RoomWidth = 1` as a placeholder while
 * stashing the actual dimensions in the `RoomDimensions` string field — a row we
 * cannot trust until Phase 1.6 stores `RoomLengthWidthUnits` and parses the
 * string. Drop any room whose BOTH dimensions are at or below this threshold.
 * The number is generous (a real bedroom edge is rarely under ~2 m / 6.5 ft);
 * any non-placeholder valid edge will exceed 1.5 in any unit.
 */
const PLACEHOLDER_DIM_THRESHOLD = 1.5;

/**
 * If a LivingAreaRange bucket midpoint exists and the rooms-sum GLA collapses to
 * a fraction this small of it, the room list is almost certainly incomplete (only
 * a few rooms have dimensions filled in). Reject the rooms path and let the
 * resolver fall through to the calibrated bucket — better a coarse but right-
 * sized fallback than a confidently-wrong measurement.
 */
const ROOMS_SUM_VS_BUCKET_FLOOR = 0.5;

/**
 * The same guard in the other direction, which was missing.
 *
 * A room sum this far ABOVE the declared band is not a large home, it is bad
 * dimension data — lot sizes in the room fields, acreage, or a decimal slip. The
 * floor above caught the incomplete-room-list case; nothing caught this one, so
 * an implausible GLA fed the AVM unchallenged.
 *
 * Measured over 73,862 listings with both room dimensions and a declared band:
 *
 *   p50  1.05   p90  1.59   p99  12.19   p99.9  51.91
 *
 * The believable mass sits at 1.0-1.6x (the grossup plus above-grade-only
 * accounting), then breaks into a junk tail. 2.5x sits well clear of p90 and
 * rejects 2,835 listings (3.8%), which fall back to the calibrated bucket exactly
 * as the floor's rejections do — a coarse right-sized estimate instead of a
 * confident wrong one.
 */
const ROOMS_SUM_VS_BUCKET_CEILING = 2.5;

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
 * Sum above-grade room areas (RoomLength × RoomWidth) into raw sqft. The unit
 * comes from {@link resolveDimensionUnit} — the feed's declaration where it has
 * one, metres otherwise. Returns null when there aren't enough dimensioned
 * above-grade rooms to trust the measurement.
 */
export function roomSumSqft(
  rooms: RoomData[] | null | undefined
): { rawSqft: number; roomCount: number; unit: DimensionUnit; unitSource: DimensionUnitSource } | null {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;

  const above: { l: number; w: number }[] = [];
  const usable: RoomData[] = [];
  for (const r of rooms) {
    const l = Number(r.RoomLength);
    const w = Number(r.RoomWidth);
    if (!(l > 0) || !(w > 0)) continue;
    // Drop placeholder rows (TRREB stashes real dims in RoomDimensions string when both are 1).
    if (l <= PLACEHOLDER_DIM_THRESHOLD && w <= PLACEHOLDER_DIM_THRESHOLD) continue;
    usable.push(r);
    if (isAboveGrade(r.RoomLevel)) above.push({ l, w });
  }
  if (above.length < MIN_DIM_ROOMS) return null;

  // Decided over the placeholder-filtered rooms, so a stray 1x1 row can't drag
  // the median down, and — unlike the old max-based rule — no single large room
  // can flip the listing.
  const { unit, source } = resolveDimensionUnit(usable);
  const unitFactor = unit === 'feet' ? 1 : SQM_TO_SQFT;
  const rawSqft = above.reduce((acc, d) => acc + d.l * d.w * unitFactor, 0);
  return { rawSqft, roomCount: above.length, unit, unitSource: source };
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

  // 2. Measured GLA from room dimensions — trusted only when it is the same order
  //    of magnitude as the seller-declared band. Too small means an incomplete
  //    room list; too large means the dimensions are not room dimensions at all
  //    (lot sizes, acreage, a decimal slip). Either way a coarse right-sized
  //    fallback beats a confidently-wrong measurement, so fall through.
  const rs = roomSumSqft(opts.rooms);
  if (rs) {
    const gla = Math.round(rs.rawSqft * GLA_GROSSUP);
    if (inRange(gla)) {
      const bucketMid = parseLivingAreaRange(payload?.['LivingAreaRange']);
      const bucketSane = bucketMid !== null && inRange(bucketMid);
      const plausible =
        !bucketSane ||
        (gla >= bucketMid * ROOMS_SUM_VS_BUCKET_FLOOR &&
          gla <= bucketMid * ROOMS_SUM_VS_BUCKET_CEILING);
      if (plausible) {
        return { sqft: gla, source: 'rooms' };
      }
    }
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
