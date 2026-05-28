/**
 * Dashboard data helpers — thin wrappers over the client-side Typesense search.
 *
 * An "area" is the market the user is asking about. It can be a TRREB region
 * string (City / CityRegion), a saved bubble's polygon, or a saved school
 * catchment. See src/lib/dashboard/area.ts — `areaFilter(area)` produces the
 * Typesense filter fragment so the call sites here don't branch on kind.
 *
 * The original `locationFilter(loc: string)` is preserved as a re-export from
 * area.ts (it now lives there as the `region` arm of `areaFilter`).
 */

import { searchListings, type ListingDocument } from '@/lib/typesense/client';
import type { BoardDef } from './boards';
import type { MarketActivityLens } from './config';
import { typesensePropertyTypeClause } from './propertyTypes';
import { areaFilter, type Area } from './area';

/**
 * Region-only filter — kept for any caller that still passes a raw string
 * (e.g. /api/market/region-stats internally). Equivalent to
 * `areaFilter({ kind: 'region', name: loc })`.
 */
export function locationFilter(loc: string): string {
  return areaFilter({ kind: 'region', name: loc });
}

function combine(...clauses: (string | undefined)[]): string {
  return clauses.filter(Boolean).join(' && ');
}

/** Top-N listings for one board within one area. */
export async function fetchBoard(
  board: BoardDef,
  area: Area,
  perPage = 5
): Promise<ListingDocument[]> {
  const res = await searchListings({
    query: '*',
    rawFilterBy: combine(areaFilter(area), board.rawFilterBy),
    sortBy: board.sortBy,
    sortOrder: board.sortOrder,
    perPage,
  });
  return res.listings;
}

export interface RegionStats {
  activeCount: number;
  topCapRate: number | null; // percentage (e.g., 7.1)
  suiteCandidates: number; // count of listings with SuiteScore >= 3
}

/** Exact, point-in-time stats for an area (no time-series — see plan §deferred). */
export async function fetchRegionStats(area: Area): Promise<RegionStats> {
  const [active, cap, suite] = await Promise.all([
    searchListings({
      query: '*',
      rawFilterBy: combine(areaFilter(area), 'ListPrice:>0'),
      perPage: 0,
    }),
    searchListings({
      query: '*',
      rawFilterBy: combine(areaFilter(area), 'ExtrapolatedCapRate:>0'),
      sortBy: 'ExtrapolatedCapRate',
      sortOrder: 'desc',
      perPage: 1,
    }),
    searchListings({
      query: '*',
      rawFilterBy: combine(areaFilter(area), 'SuiteScore:>=3'),
      perPage: 0,
    }),
  ]);
  return {
    activeCount: active.totalFound,
    topCapRate: cap.listings[0]?.ExtrapolatedCapRate ?? null,
    suiteCandidates: suite.totalFound,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_PRICE_FLOOR = 50000; // mirror the sold feed: excludes leases/rentals

// BasementType values that indicate finished living space — mirrors the sold-feed
// derivation (deriveHasFinishedBasement: any "apartment" or non-"unfinished"
// "finished" token). Exact "Finished" alone misses Apartment / walk-out / partial.
const FINISHED_BASEMENT_VALUES = [
  'Finished',
  'Apartment',
  'Finished with Walk-Out',
  'Partially Finished',
];

function finishedBasementClause(): string {
  const ors = FINISHED_BASEMENT_VALUES.map((v) => `BasementType:=\`${v}\``);
  return `(${ors.join(' || ')})`;
}

/**
 * Typesense filter_by for "new active listings in the last N days" under a lens.
 *
 * NOTE: this collection has no usable `Status:=Active` flag (it stores TRREB
 * MlsStatus sub-states like "New"/"Price Change"); the whole index is the active
 * IDX feed, so we scope by the EntryTimestamp window only. `EntryTimestamp` is in
 * MILLISECONDS (transformer.ts), so the cutoff is `Date.now() - days*DAY_MS`.
 * `ListPrice:>=50000` drops lease rows (no filterable TransactionType field).
 */
export function buildActivityFilter(area: Area, lens: MarketActivityLens): string {
  const cutoff = Date.now() - lens.windowDays * DAY_MS;
  return combine(
    areaFilter(area),
    `EntryTimestamp:>=${Math.floor(cutoff)}`,
    `ListPrice:>=${ACTIVITY_PRICE_FLOOR}`,
    typesensePropertyTypeClause(lens.propertyTypes),
    lens.minBeds > 0 ? `BedroomsTotal:>=${lens.minBeds}` : undefined,
    lens.minBaths > 0 ? `BathroomsTotalInteger:>=${lens.minBaths}` : undefined,
    lens.minGarage > 0 ? `ParkingTotal:>=${lens.minGarage}` : undefined,
    lens.basementFinished ? finishedBasementClause() : undefined,
    lens.minFrontage > 0 ? `LotWidth:>=${lens.minFrontage}` : undefined
  );
}

/** Count of newly-listed active properties for an area under the lens. */
export async function fetchNewCount(area: Area, lens: MarketActivityLens): Promise<number> {
  const res = await searchListings({
    query: '*',
    rawFilterBy: buildActivityFilter(area, lens),
    perPage: 0,
  });
  return res.totalFound;
}

/** Newest-first list of new active listings (capped at 100 — TRREB §6.3(b)). */
export async function fetchNewListings(
  area: Area,
  lens: MarketActivityLens,
  limit = 5
): Promise<ListingDocument[]> {
  const res = await searchListings({
    query: '*',
    rawFilterBy: buildActivityFilter(area, lens),
    sortBy: 'EntryTimestamp',
    sortOrder: 'desc',
    perPage: Math.min(limit, 100),
  });
  return res.listings;
}
