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
import type { TransactionScope } from './config';

export type BoardId =
  | 'cap_rate'
  | 'suite'
  | 'price_drop'
  | 'high_dom'
  | 'carry';

/**
 * Board ids that existed once and no longer do. A stored config keeps whatever it was
 * saved with, so `normalizeConfig` needs to know which ids to drop rather than carry a
 * dead entry around forever (see config.ts).
 *
 * 'fresh' — "Freshest Listings" (TrueDom ascending). The New column of
 * MarketActivityPanel already leads every section with the same listings, sorted by
 * EntryTimestamp. The two disagree only on relists, which is not a distinction worth a
 * whole board directly under the column that contradicts it.
 */
export const RETIRED_BOARD_IDS: readonly string[] = ['fresh'];

/** The lens-dependent face of a board — the fields that differ between sale and
 *  lease mode (title, headline metric, sort, filter). See `lease` on BoardDef and
 *  `resolveBoardView`. */
export interface BoardLensView {
  title: string;
  metricField: keyof ListingDocument;
  metricLabel: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  rawFilterBy?: string;
}

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
  /** transaction modes this board is valid for. Sale-only boards (cap rate, carry,
   *  suite) are hidden in "For Rent" mode; boards with a `lease` override adapt. */
  scopes: TransactionScope[];
  /** "For Rent" overrides — the rental-native metric (LeaseTrueDom / LeaseTotalPriceDrop).
   *  Absent → the board is sale-only. formatMetric is shared with the sale view. */
  lease?: BoardLensView;
}

/**
 * The board's effective face for a given lens. In lease mode a board with a `lease`
 * override swaps to its rental-native metric; otherwise the sale definition is used.
 * `formatMetric` is shared (LeaseTrueDom is days like TrueDom; LeaseTotalPriceDrop is
 * dollars like TotalPriceDrop).
 */
export interface ResolvedBoardView {
  title: string;
  metricField: keyof ListingDocument;
  metricLabel: string;
  formatMetric: (v: number | undefined | null) => string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  rawFilterBy?: string;
}

export function resolveBoardView(
  board: BoardDef,
  transactionType: TransactionScope
): ResolvedBoardView {
  const v: BoardLensView =
    transactionType === 'lease' && board.lease
      ? board.lease
      : {
          title: board.title,
          metricField: board.metricField,
          metricLabel: board.metricLabel,
          sortBy: board.sortBy,
          sortOrder: board.sortOrder,
          rawFilterBy: board.rawFilterBy,
        };
  return { ...v, formatMetric: board.formatMetric };
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
    // Sale-only: cap rate needs a purchase price; the ETL zeroes it for leases.
    scopes: ['sale'],
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
    // Sale-only: a suite/conversion investor board, off-topic for renters.
    scopes: ['sale'],
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
    scopes: ['sale', 'lease'],
    lease: {
      title: 'Biggest Rent Reductions',
      metricField: 'LeaseTotalPriceDrop',
      metricLabel: 'RENT CUT',
      sortBy: 'LeaseTotalPriceDrop',
      sortOrder: 'desc',
      rawFilterBy: 'LeaseTotalPriceDrop:>0',
    },
  },
  high_dom: {
    id: 'high_dom',
    title: 'Highest True DOM',
    metricField: 'TrueDom',
    metricLabel: 'TRUE DOM',
    formatMetric: days,
    sortBy: 'TrueDom',
    sortOrder: 'desc',
    // Longest genuinely-on-market listings (True DOM stitches relists back together) —
    // the motivated-seller / negotiation-leverage board. This is the only end of the
    // TrueDom axis with its own reader: the fresh end duplicated the New column.
    rawFilterBy: 'TrueDom:>=0',
    objectives: ['Target distressed & off-market deals'],
    scopes: ['sale', 'lease'],
    lease: {
      title: 'Longest-Listed Rentals',
      metricField: 'LeaseTrueDom',
      metricLabel: 'RENTAL DOM',
      sortBy: 'LeaseTrueDom',
      sortOrder: 'desc',
      rawFilterBy: 'LeaseTrueDom:>=0',
    },
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
    // Sale-only: capital burn is a purchase carrying-cost; meaningless for a rental.
    scopes: ['sale'],
  },
};

/** Default board order when the user has no objective signal. */
export const DEFAULT_BOARD_ORDER: BoardId[] = [
  'cap_rate',
  'suite',
  'price_drop',
  'high_dom',
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
