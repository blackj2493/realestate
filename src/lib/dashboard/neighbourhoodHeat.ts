/**
 * Neighbourhood Heat aggregation — per-community (CityRegion) stats over a region's
 * FULL active inventory (owner call 2026-07-25: the old 100-listing UI sample gave
 * Brampton communities 1–3 listings each, so the leaderboard ranked noise).
 *
 * Pure functions — the API route feeds them listings fetched server-side; derived
 * statistics only ever leave the server (no listing rows), so the §6.3(b) display
 * cap does not apply (same rationale as /api/market/region-scores).
 */

/** A community only ranks with at least this many listings behind the metric. */
export const MIN_COMMUNITY_N = 5;
/** Rows the tile shows before "Show all N" — the full ranking is always returned
 *  (owner call 2026-07-25: users need to find THEIR community, not just the top). */
export const COLLAPSED_ROWS = 6;
/** A metric is worth showing only when this many communities clear the floor. */
export const MIN_QUALIFYING_COMMUNITIES = 3;

export interface HeatInput {
  region: string | null | undefined;
  cap: number | null | undefined;
  dom: number | null | undefined;
  drop: number | null | undefined;
  /** Asking price (ListPrice) — the fourth lens: price level by community. */
  price: number | null | undefined;
  lat: number | null | undefined;
  lng: number | null | undefined;
}

export interface CommunityStat {
  name: string;
  median: number;
  count: number;
  /** Centroid of the contributing listings — the row's map deep-link target. */
  lat: number;
  lng: number;
}

export interface HeatStats {
  cap: CommunityStat[];
  dom: CommunityStat[];
  drop: CommunityStat[];
  price: CommunityStat[];
  /** Active listings analyzed (the aggregation population, NOT a display count). */
  analyzed: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function rankMetric(items: HeatInput[], get: (i: HeatInput) => number | null | undefined): CommunityStat[] {
  const groups = new Map<string, { values: number[]; latSum: number; lngSum: number; geoN: number }>();
  for (const i of items) {
    const name = (i.region || "").trim();
    const v = get(i);
    if (!name || v == null || !Number.isFinite(v) || v <= 0) continue;
    const g = groups.get(name) ?? { values: [], latSum: 0, lngSum: 0, geoN: 0 };
    g.values.push(v);
    if (i.lat != null && i.lng != null && Number.isFinite(i.lat) && Number.isFinite(i.lng)) {
      g.latSum += i.lat;
      g.lngSum += i.lng;
      g.geoN++;
    }
    groups.set(name, g);
  }
  // EVERY qualifying community, ranked — the client collapses to COLLAPSED_ROWS and
  // offers "Show all N" (a ~40-community payload is tiny; truncating here would make
  // "where does MY community rank?" unanswerable).
  return [...groups.entries()]
    .filter(([, g]) => g.values.length >= MIN_COMMUNITY_N && g.geoN > 0)
    .map(([name, g]) => ({
      name,
      median: median(g.values),
      count: g.values.length,
      lat: g.latSum / g.geoN,
      lng: g.lngSum / g.geoN,
    }))
    .sort((a, b) => b.median - a.median);
}

/** All four leaderboards in one pass so the client's metric toggle needs no re-fetch. */
export function aggregateCommunities(items: HeatInput[]): HeatStats {
  return {
    cap: rankMetric(items, (i) => i.cap),
    dom: rankMetric(items, (i) => i.dom),
    drop: rankMetric(items, (i) => i.drop),
    price: rankMetric(items, (i) => i.price),
    analyzed: items.length,
  };
}

/** True when at least one metric can render a credible leaderboard. */
export function hasUsableHeat(stats: HeatStats): boolean {
  return [stats.cap, stats.dom, stats.drop, stats.price].some(
    (rows) => rows.length >= MIN_QUALIFYING_COMMUNITIES
  );
}
