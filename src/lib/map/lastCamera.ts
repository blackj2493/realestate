/**
 * The terminal's last settled camera, persisted across sessions.
 *
 * WHY THIS EXISTS: opening the map needs an answer to "where?". The previous answer was
 * the user's first saved dashboard area, translated into a Typesense TEXT query — which
 * pinned the whole terminal to that string. `regionCamera` could place only 37 of 486
 * active cities, so 63.5% of listings fell through to that filter; saving "Maple" also
 * matched "Mapleton", 130km away, and the map arrived with a "Maple only · Show N more"
 * bar the user had to notice and dismiss.
 *
 * Where you last looked is a better answer than a preference you set once and forgot, and
 * it is GEOMETRY — so it scopes the query by viewport the way panning already does, and
 * needs no per-place lookup table to maintain. It is also what the rest of the industry
 * does: realtor.ca drives its map from LatitudeMax/LongitudeMax + ZoomLevel + GeoIds, not
 * from a place string.
 *
 * A camera is NOT a filter. Restoring one leaves `location` empty, so `wantViewportScope`
 * stays true and results follow the map. Panning out of the restored area just works —
 * which is the property the text filter destroyed.
 *
 * Stored under its own key rather than in the dashboard config: this is terminal state,
 * it changes on every pan, and it must not make a saved-areas edit look like a workspace
 * change (or vice versa).
 */

const KEY = 'pp_terminal_camera';

export interface Camera {
  lat: number;
  lng: number;
  zoom: number;
}

/**
 * Reject anything that would fly the map somewhere useless. 0,0 is the specific trap —
 * it is the shape a half-initialised camera takes, it passes a naive finite check, and it
 * lands in the Gulf of Guinea, which reads as a broken app rather than a missing value.
 */
function valid(c: unknown): c is Camera {
  if (!c || typeof c !== 'object') return false;
  const { lat, lng, zoom } = c as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number' || typeof zoom !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false;
  // deck.gl clamps beyond this anyway; a stored 40 would restore a blank tile.
  if (zoom < 1 || zoom > 22) return false;
  return true;
}

/** The stored camera, or null. Never throws: a bad read must fall back to the default. */
export function readLastCamera(): Camera | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? { lat: parsed.lat, lng: parsed.lng, zoom: parsed.zoom } : null;
  } catch {
    return null;
  }
}

/**
 * Persist a settled camera. Best-effort by design — this runs on every pan, and a private
 * window or a full quota must never surface as an error on a map the user is dragging.
 */
export function writeLastCamera(c: Camera): void {
  if (typeof window === 'undefined') return;
  if (!valid(c)) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: c.zoom }));
  } catch {
    /* private mode / quota — the in-session store copy still works */
  }
}
