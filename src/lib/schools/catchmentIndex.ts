/**
 * The process-wide catchment index the ETL reads per listing.
 *
 * `assignSchools` can be a plain synchronous call because its data is a committed JSON file.
 * Catchments are not: they live in `geo_features`, the harvester rewrites them in place when
 * a board redraws, and a checked-in copy would drift. So the index is PRIMED once, before
 * any transforming starts, and read synchronously 102,000 times after that.
 *
 * IT FAILS LOUD, AND THAT IS THE WHOLE DESIGN. `catchmentsForPoint` throws when the index
 * was never primed, instead of returning an empty array. An empty array is a valid answer —
 * it means "this point is in no catchment" — so a silent un-primed index would write `[]`
 * onto every document in the collection and the school filter would return nothing for every
 * school, everywhere, with no error anywhere. The same shape as the metrics that fail to
 * null and then freeze. A thrown error stops the run instead.
 *
 * The floor guard is the second half of that: a read that succeeds but returns almost
 * nothing (a truncated page, a board wiped by a rotated ArcGIS URL) is refused rather than
 * published, because it is indistinguishable from success at the call site.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildCatchmentIndex,
  catchmentTokensFor,
  type CatchmentIndex,
} from "./catchmentMembership";
import { fetchCatchmentZones } from "./catchmentSource";

/**
 * Fewest zones a healthy load may return.
 *
 * 3,089 of 3,296 rows carried a usable `school_id` on 2026-09-24. 2,000 leaves room for a
 * board to drop out or a harvest to shrink without tripping, while still catching the
 * failure that matters: a partial read that would quietly un-catchment most of Ontario.
 */
export const MIN_CATCHMENT_ZONES = 2000;

let INDEX: CatchmentIndex | null = null;

export interface PrimeResult {
  zones: number;
  cells: number;
  rowsRead: number;
  withoutSchoolId: number;
  unreadableGeometry: number;
  ms: number;
}

/**
 * Load the boundaries and build the lookup. Call once per process, before transforming.
 *
 * Throws on a failed read or a suspiciously small one. The caller is a batch job, and a job
 * that cannot catchment its listings should stop rather than publish a collection that
 * silently answers "no" to every school search.
 */
export async function primeCatchmentIndex(supabase: SupabaseClient): Promise<PrimeResult> {
  const t0 = Date.now();
  const res = await fetchCatchmentZones(supabase);
  if (res.zones.length < MIN_CATCHMENT_ZONES) {
    throw new Error(
      `catchment load returned ${res.zones.length} zones from ${res.rows} rows, ` +
        `below the ${MIN_CATCHMENT_ZONES} floor — refusing to index. ` +
        `A partial read here blanks the school filter for every school.`
    );
  }
  INDEX = buildCatchmentIndex(res.zones);
  return {
    zones: INDEX.zones.length,
    cells: INDEX.cells.size,
    rowsRead: res.rows,
    withoutSchoolId: res.withoutSchoolId,
    unreadableGeometry: res.unreadableGeometry,
    ms: Date.now() - t0,
  };
}

/** True once primeCatchmentIndex has succeeded in this process. */
export const isCatchmentIndexPrimed = (): boolean => INDEX !== null;

/**
 * Catchment tokens containing this point.
 *
 * Throws when the index was never primed — see the header. A point with no coordinates
 * returns `[]`, which is the correct answer rather than a failure: an ungeocoded listing is
 * in no catchment, and that is also what its `NearbySchools` says.
 */
export function catchmentsForPoint(lat: number | null | undefined, lng: number | null | undefined): string[] {
  if (!INDEX) {
    throw new Error(
      "catchmentsForPoint called before primeCatchmentIndex — refusing to report " +
        "'no catchments' for a point we never looked up."
    );
  }
  if (typeof lat !== "number" || typeof lng !== "number") return [];
  return catchmentTokensFor(lat, lng, INDEX);
}

/** Test seam. Never call this from the ETL. */
export function __setCatchmentIndexForTests(index: CatchmentIndex | null): void {
  INDEX = index;
}
