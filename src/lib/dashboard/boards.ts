/**
 * Investment Playlist registry — the core of the home dashboard.
 *
 * Each board is one deterministic Typesense query (sort + optional filter) over the
 * `properties` collection, capped at 5 rows (well under the 100-listing TRREB cap,
 * CLAUDE.md §4). No IDX/VOW data is transformed by any LLM — pure sorts/filters.
 *
 * Every sortBy / rawFilterBy field below is verified indexed in typesenseSchema.ts.
 * NOTE: `isDistressed` is NOT an indexed field — the distress board uses the indexed
 * `TotalPriceDrop` instead.
 */

import type { ListingDocument } from '@/lib/typesense/client';

export type BoardId =
  | 'cap_rate'
  | 'suite'
  | 'fresh'
  | 'price_drop'
  | 'density'
  | 'carry';

export interface BoardDef {
  id: BoardId;
  title: string;
  /** which numeric field is the per-row headline metric */
  metricField: keyof ListingDocument;
  metricLabel: string;
  formatMetric: (v: number | undefined | null) => string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  /** extra Typesense filter_by clause (colon-operator syntax) */
  rawFilterBy?: string;
  /** /apply objectives this board best serves — drives lead ordering */
  objectives: string[];
}

// cap_rate_est is stored as a percentage (7.1 → "7.1%").
const pct = (v: number | undefined | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`;
const money = (v: number | undefined | null) =>
  v == null || !Number.isFinite(v) ? '—' : `$${Math.round(v).toLocaleString()}`;
const days = (v: number | undefined | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${Math.round(v)}d`;
const score6 = (v: number | undefined | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${v}/6`;
const sqft = (v: number | undefined | null) =>
  v == null || !Number.isFinite(v) || v <= 0 ? '—' : `${Math.round(v).toLocaleString()} sf`;

export const BOARDS: Record<BoardId, BoardDef> = {
  cap_rate: {
    id: 'cap_rate',
    title: 'Highest Cap Rate',
    metricField: 'cap_rate_est',
    metricLabel: 'CAP',
    formatMetric: pct,
    sortBy: 'cap_rate_est',
    sortOrder: 'desc',
    rawFilterBy: 'cap_rate_est:>=1 && cap_rate_est:<=15',
    objectives: ['Analyze rental yield / cap rates'],
  },
  suite: {
    id: 'suite',
    title: 'Best Duplex / Suite Candidates',
    metricField: 'SuiteScore',
    metricLabel: 'SUITE',
    formatMetric: score6,
    sortBy: 'SuiteScore',
    sortOrder: 'desc',
    rawFilterBy: 'SuiteScore:>=3',
    objectives: ['Source zoning & conversion upside', 'Buy a home with hidden value (suite / basement potential)'],
  },
  fresh: {
    id: 'fresh',
    title: 'Freshest Listings',
    metricField: 'TrueDom',
    metricLabel: 'TRUE DOM',
    formatMetric: days,
    sortBy: 'TrueDom',
    sortOrder: 'asc',
    rawFilterBy: 'TrueDom:>=0',
    objectives: [],
  },
  price_drop: {
    id: 'price_drop',
    title: 'Biggest Price Drops',
    metricField: 'TotalPriceDrop',
    metricLabel: 'DROP',
    formatMetric: money,
    sortBy: 'TotalPriceDrop',
    sortOrder: 'desc',
    rawFilterBy: 'TotalPriceDrop:>0',
    objectives: ['Target distressed & off-market deals'],
  },
  density: {
    id: 'density',
    title: 'Surplus-Parking Lots',
    metricField: 'LotSqftTotal',
    metricLabel: 'LOT',
    formatMetric: sqft,
    sortBy: 'LotSqftTotal',
    sortOrder: 'desc',
    rawFilterBy: 'is_density_ready:=true',
    objectives: ['Land assembly / development'],
  },
  carry: {
    id: 'carry',
    title: 'Lowest Capital Burn',
    metricField: 'CapitalBurnRateMonthly',
    metricLabel: 'BURN/MO',
    formatMetric: money,
    sortBy: 'CapitalBurnRateMonthly',
    sortOrder: 'asc',
    rawFilterBy: 'CapitalBurnRateMonthly:>0',
    objectives: ['Analyze rental yield / cap rates'],
  },
};

/** Default board order when the user has no objective signal. */
export const DEFAULT_BOARD_ORDER: BoardId[] = [
  'cap_rate',
  'suite',
  'fresh',
  'price_drop',
  'density',
  'carry',
];

export const ALL_BOARD_IDS: BoardId[] = DEFAULT_BOARD_ORDER;

/**
 * Order boards so the ones matching the applicant's stated objectives lead, while
 * still returning the full set (the user can toggle individual boards off later).
 */
export function orderBoardsByObjectives(objectives: string[]): BoardId[] {
  if (!objectives || objectives.length === 0) return [...DEFAULT_BOARD_ORDER];
  const matched: BoardId[] = [];
  const rest: BoardId[] = [];
  for (const id of DEFAULT_BOARD_ORDER) {
    const hit = BOARDS[id].objectives.some((o) => objectives.includes(o));
    (hit ? matched : rest).push(id);
  }
  return [...matched, ...rest];
}
