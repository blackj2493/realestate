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

// ── Representative pin selection ─────────────────────────────────────────────
// Listings mode draws a price label for every UN-clustered listing. Left
// unbounded that lets a few far-flung, extreme-priced listings (a lone $15M pin
// in a sparse pocket) win most of the visible labels while ordinary inventory
// hides inside count bubbles. To keep the individual labels spatially
// representative, bucket the un-clustered listings into a coarse grid over THEIR
// OWN extent (so the grid tracks where the listings actually are and is stable
// across map pans — no per-frame re-gridding) and keep at most `perCell` per
// occupied cell: the MEDIAN-priced one (so an outlier can never take the slot)
// and, when a slot remains, the FRESHEST. Clusters/counts are untouched — this
// only decides which price labels render.
export const PIN_GRID_COLS = 8;
export const PIN_GRID_ROWS = 6;
export const PINS_PER_CELL = 2;

/** Up to `perCell` representatives of one grid cell: median price, then freshest,
 *  then fill outward from the price-central band. Assumes group.length > perCell. */
function selectCellRepresentatives<T>(
  group: T[],
  perCell: number,
  getPrice: (t: T) => number,
  getFreshness?: (t: T) => number
): T[] {
  const byPrice = [...group].sort((a, b) => getPrice(a) - getPrice(b));
  const chosen: T[] = [];
  const take = (t: T | null | undefined) => {
    if (t && !chosen.includes(t)) chosen.push(t);
  };
  const mid = Math.floor((byPrice.length - 1) / 2);
  take(byPrice[mid]); // median-priced — the representative, never the outlier
  if (chosen.length < perCell && getFreshness) {
    let best: T | null = null;
    let bestF = -Infinity;
    for (const g of group) {
      if (chosen.includes(g)) continue;
      const f = getFreshness(g);
      if (f > bestF) {
        bestF = f;
        best = g;
      }
    }
    take(best);
  }
  // Any remaining slots: expand from the median outward (central prices first).
  let lo = mid - 1;
  let hi = mid + 1;
  while (chosen.length < perCell && (lo >= 0 || hi < byPrice.length)) {
    if (hi < byPrice.length) take(byPrice[hi++]);
    if (chosen.length < perCell && lo >= 0) take(byPrice[lo--]);
  }
  return chosen;
}

/**
 * Thin a set of point-carrying items to at most `perCell` per coarse grid cell,
 * choosing representative (median-priced + freshest) members so extreme-priced
 * outliers and dense pockets can't dominate the rendered labels. Returns the kept
 * items in their original order (order is visually irrelevant for a TextLayer, but
 * stable output keeps this deterministic + testable). Cheap enough (≤100 items) to
 * run on every result set.
 */
export function pickRepresentativePins<T>(
  items: T[],
  opts: {
    cols: number;
    rows: number;
    perCell: number;
    getLngLat: (t: T) => [number, number];
    getPrice: (t: T) => number;
    getFreshness?: (t: T) => number;
  }
): T[] {
  const { cols, rows, perCell, getLngLat, getPrice, getFreshness } = opts;
  if (items.length === 0 || cols < 1 || rows < 1 || perCell < 1) return items;

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const it of items) {
    const [lng, lat] = getLngLat(it);
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  const lngSpan = east - west;
  const latSpan = north - south;
  const cellOf = (lng: number, lat: number): number => {
    const cx = lngSpan > 0 ? Math.min(cols - 1, Math.floor(((lng - west) / lngSpan) * cols)) : 0;
    const cy = latSpan > 0 ? Math.min(rows - 1, Math.floor(((north - lat) / latSpan) * rows)) : 0;
    return cy * cols + cx;
  };

  const buckets = new Map<number, T[]>();
  for (const it of items) {
    const [lng, lat] = getLngLat(it);
    const key = cellOf(lng, lat);
    const arr = buckets.get(key);
    if (arr) arr.push(it);
    else buckets.set(key, [it]);
  }

  const keep = new Set<T>();
  for (const group of buckets.values()) {
    if (group.length <= perCell) {
      for (const g of group) keep.add(g);
      continue;
    }
    for (const g of selectCellRepresentatives(group, perCell, getPrice, getFreshness)) {
      keep.add(g);
    }
  }
  return items.filter((it) => keep.has(it));
}
