// src/lib/reno/marketSnapshot.ts
//
// Shared types + PURE helpers for the personalized "market trends" doorway on the
// renovation-upside tool. The heavy lifting (the cached region RPCs) happens in
// /api/reno/market-snapshot; everything here is deterministic arithmetic and string
// templating over numbers the aggregates already returned — no AI (CLAUDE.md §4),
// and no server imports, so a client component can import it freely.

/** One monthly sold point — the subset of market TrendPoint this module needs. */
export interface SnapshotTrendPoint {
  month: string; // YYYY-MM
  medianPrice: number;
  sales: number;
}

export interface RenoMarketSnapshot {
  /** Canonical region value to query/deep-link with (raw city_region or city). */
  region: string;
  /** Human label for the same region. */
  label: string;
  /** Whether the numbers are the neighbourhood's own or the city-wide fallback. */
  scope: 'community' | 'city';
  /** Sales-weighted median sold price over the trailing 3 complete months. */
  medianPrice: number | null;
  /** % change vs the same 3 months a year earlier. */
  yoyPct: number | null;
  /** Sold count over the trailing 90 days. */
  sales90: number;
  /** Median days to sell (trailing 12mo). */
  medianDom: number | null;
  /** Median sold-to-list %, e.g. 98.4. */
  soldToListPct: number | null;
  /** Share (0..1) of active listings that have cut their asking price. */
  cutShare: number | null;
  /** Median % cut among the listings that cut (positive magnitude — render as −x%). */
  medianCutPct: number | null;
  /** Share (0..1) of sales that closed below their ORIGINAL ask. */
  underAskShare: number | null;

  // ── the shadow metrics: what the board's own numbers hide ──
  /** Active listings in scope. */
  activeCount: number;
  /** Median TRUE days on market — relists stitched back together. */
  trueDom: number | null;
  /** Median days as the board shows it (clock resets on relist). */
  naiveDom: number | null;
  /** Share (0..1) of active listings sitting 60+ true days. */
  stalePct: number | null;
  /** Share (0..100) of market exits that actually closed (vs de-listed unsold). */
  sellThroughPct: number | null;
  /** Median true DOM of the listings that gave up without selling. */
  failedMedianDom: number | null;
}

export type RenoMarketSnapshotResp =
  | ({ locked: false } & RenoMarketSnapshot)
  | { locked: true; region: string; label: string };

/** Trailing-window sales-weighted average of monthly medians. Null when the window is empty. */
function weighted(points: SnapshotTrendPoint[]): number | null {
  let value = 0;
  let sales = 0;
  for (const p of points) {
    if (!(p.sales > 0) || !(p.medianPrice > 0)) continue;
    value += p.medianPrice * p.sales;
    sales += p.sales;
  }
  return sales > 0 ? value / sales : null;
}

/** Shift a YYYY-MM key back by 12 months. */
function yearBefore(month: string): string {
  const [y, m] = month.split('-');
  return `${Number(y) - 1}-${m}`;
}

/**
 * Year-over-year % change in median sold price: the trailing 3 complete months with
 * sales vs the SAME three months a year earlier. Requires at least 2 matched pairs so a
 * single thin month can't manufacture a swing. Returns null when the history is too thin.
 */
export function computeYoyPct(points: SnapshotTrendPoint[]): number | null {
  const withSales = points.filter((p) => p.sales > 0 && p.medianPrice > 0);
  if (withSales.length === 0) return null;
  const recent = withSales.slice(-3);
  const byMonth = new Map(withSales.map((p) => [p.month, p]));
  const prior = recent.map((p) => byMonth.get(yearBefore(p.month))).filter((p): p is SnapshotTrendPoint => !!p);
  if (prior.length < 2) return null;

  // Compare like with like: only the recent months that have a year-ago counterpart.
  const priorMonths = new Set(prior.map((p) => p.month));
  const paired = recent.filter((p) => priorMonths.has(yearBefore(p.month)));
  const now = weighted(paired);
  const then = weighted(prior);
  if (now == null || then == null || then <= 0) return null;
  return ((now - then) / then) * 100;
}

/** Sales-weighted median sold price over the trailing 3 complete months. */
export function computeMedianPrice(points: SnapshotTrendPoint[]): number | null {
  const withSales = points.filter((p) => p.sales > 0 && p.medianPrice > 0);
  const w = weighted(withSales.slice(-3));
  return w == null ? null : Math.round(w);
}

/**
 * The one-line personalized read: direction of prices + how long homes take to sell.
 * Deterministic templating over the snapshot's own numbers.
 */
export function snapshotHeadline(s: RenoMarketSnapshot, typeLabel?: string | null): string {
  const parts: string[] = [];
  // When the snapshot was scoped to a property type, say so — "sold prices" alone reads
  // as all housing stock, which is exactly the over-generalization we're fixing.
  const kind = typeLabel ? `${typeLabel} sold prices` : 'Sold prices';
  if (s.yoyPct != null) {
    const mag = Math.abs(s.yoyPct);
    if (mag < 1) parts.push(`${kind} in ${s.label} are flat on the year`);
    else parts.push(`${kind} in ${s.label} are ${s.yoyPct > 0 ? 'up' : 'down'} ${mag.toFixed(1)}% on the year`);
  } else if (s.medianPrice != null) {
    parts.push(
      `${typeLabel ? `${typeLabel} homes` : 'Homes'} in ${s.label} are selling around $${Math.round(s.medianPrice).toLocaleString('en-CA')}`,
    );
  } else {
    parts.push(`Here is how ${s.label} is actually trading`);
  }

  // The punchline, when we have it: the gap between how long listings have REALLY been
  // sitting and the clock the board restarts on every relist. Nobody else shows this.
  const gap = domGapDays(s);
  if (gap != null && gap >= DOM_GAP_MIN_DAYS) {
    parts.push(
      `and listings have really been sitting ${Math.round(s.trueDom!)} days — ${gap} more than the board's clock shows`,
    );
  } else if (s.medianDom != null && s.medianDom > 0) {
    parts.push(`and a typical home takes ${Math.round(s.medianDom)} days to sell`);
  } else if (s.sales90 > 0) {
    parts.push(`across ${s.sales90} sales in the last 90 days`);
  }
  return `${parts.join(' ')}.`;
}

/** Below this the relist gap is noise, not a story. */
export const DOM_GAP_MIN_DAYS = 5;

/** How many days the board's clock under-reports, or null when we can't tell. */
export function domGapDays(s: RenoMarketSnapshot): number | null {
  if (s.trueDom == null || s.naiveDom == null) return null;
  const gap = Math.round(s.trueDom) - Math.round(s.naiveDom);
  return gap > 0 ? gap : null;
}

/** Scope line under the headline: what the tiles were computed over. Never a tile's own figure. */
export function snapshotScopeLine(s: RenoMarketSnapshot, typeLabel?: string | null): string | null {
  const kind = typeLabel ? typeLabel.toLowerCase() : 'home';
  const bits: string[] = [];
  if (s.sales90 > 0) bits.push(`${s.sales90} ${kind} sales in the last 90 days`);
  if (s.activeCount > 0) bits.push(`${s.activeCount} listings on the market now`);
  if (bits.length === 0) return null;
  return `Measured across ${bits.join(' and ')}.`;
}
