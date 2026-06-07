/**
 * Pure, browser-free map logic extracted from AlphaMap so it can be unit-tested
 * without importing deck.gl / mapbox (which require a DOM). AlphaMap imports
 * these helpers; tests import them directly.
 */

// Continental-Canada sanity bounds. Also rejects swapped [lng, lat] coordinates:
// Canadian longitudes are negative, so a swapped pair lands lat ≈ -79, which is
// far below minLat and gets filtered out.
export const CANADA_BOUNDS = { minLat: 41, maxLat: 84, minLng: -141, maxLng: -53 };

// supercluster config used by AlphaMap's Listings mode. Exported so tests
// exercise the exact same clustering behavior the UI uses.
// maxZoom must match the map controller's max zoom (MAP_MAX_ZOOM): beyond
// supercluster's maxZoom, coincident points (e.g. condo units in one postal
// code) stop clustering and stack as overlapping pills. Keeping them equal
// guarantees condo stacks stay collapsed across the entire reachable range.
export const MAP_MAX_ZOOM = 20;
export const CLUSTER_OPTIONS = { radius: 64, maxZoom: MAP_MAX_ZOOM, minPoints: 2 } as const;

/**
 * Is a stored [lat, lng] geopoint plausible for rendering?
 * Guards against null/undefined, NaN, the (0,0) null-island sentinel, and
 * out-of-Canada / swapped coordinates.
 */
export function isValidLocation(location: [number, number] | null | undefined): boolean {
  if (!location) return false;
  const lat = location[0];
  const lng = location[1];
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat !== 0 &&
    lng !== 0 &&
    lat >= CANADA_BOUNDS.minLat &&
    lat <= CANADA_BOUNDS.maxLat &&
    lng >= CANADA_BOUNDS.minLng &&
    lng <= CANADA_BOUNDS.maxLng
  );
}

/**
 * Stored order is [lat, lng]; deck.gl getPosition wants [lng, lat]. Flip.
 */
export function toDeckPosition(location: [number, number]): [number, number] {
  return [location[1], location[0]];
}

/**
 * Map a metric value onto an index into a color ramp, clamped to [0, len-1].
 * NaN (e.g. a missing metric) collapses to the low end rather than indexing
 * out of bounds.
 */
export function colorIndexFor(value: number, domain: [number, number], rangeLength: number): number {
  if (Number.isNaN(value) || rangeLength <= 0) return 0;
  const [lo, hi] = domain;
  const t = hi > lo ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0;
  return Math.min(rangeLength - 1, Math.floor(t * (rangeLength - 1)));
}

/**
 * Compact price label for listing pins ($1.2M / $899K). Non-positive / missing
 * prices render as an em dash.
 */
export function formatPriceShort(price?: number | null): string {
  if (!price || price <= 0) return "—";
  if (price >= 1_000_000) {
    const m = price / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (price >= 1_000) return `$${Math.round(price / 1_000)}K`;
  return `$${price}`;
}

/**
 * supercluster tags aggregated features with `cluster: true`; individual leaves
 * carry the listing payload instead.
 */
export function isClusterFeature(f: { properties: Record<string, unknown> }): boolean {
  return f.properties.cluster === true;
}

/** Cluster radius (px) by zoom — smaller when zoomed out so dense comps don't blob
 *  into one bubble; truly coincident points (one building) still cluster at any radius. */
export function clusterRadiusForZoom(zoom: number): number {
  return zoom <= 12 ? 28 : zoom <= 14 ? 40 : 56;
}

/** Neutral "no estimate" pin color (slate-500) — for sparse metrics whose value
 *  is absent. Distinct from the low end of any ramp so "no data" never reads as "low". */
export const NO_DATA_COLOR: [number, number, number] = [100, 116, 139];

/**
 * Does this metric value count as present? Non-sparse metrics (price, DOM, drop…)
 * treat 0 as a legitimate value. Sparse metrics (cap rate / gross yield, ~47%
 * populated) treat non-positive / NaN as "no estimate".
 */
export function hasMetricValue(value: number, sparse?: boolean): boolean {
  if (!sparse) return true;
  return Number.isFinite(value) && value > 0;
}

/**
 * Pin/scatter color for a metric value. Sparse + no-estimate → neutral NO_DATA_COLOR;
 * otherwise the domain-mapped ramp color (existing behavior).
 */
export function scatterColorFor(
  value: number,
  domain: [number, number],
  range: [number, number, number][],
  sparse?: boolean
): [number, number, number] {
  if (!hasMetricValue(value, sparse)) return NO_DATA_COLOR;
  return range[colorIndexFor(value, domain, range.length)];
}
