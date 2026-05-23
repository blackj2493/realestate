/**
 * Dashboard data helpers — thin wrappers over the client-side Typesense search.
 *
 * A "location" is a user-chosen market area. It can be a municipality (Typesense
 * `City`) or a neighbourhood (`CityRegion`), so every query matches BOTH. Values are
 * backtick-quoted because names contain spaces (e.g. "Richmond Hill", "Stoney Creek").
 */

import { searchListings, type ListingDocument } from '@/lib/typesense/client';
import type { BoardDef } from './boards';
import type { MarketActivityLens } from './config';
import { typesensePropertyTypeClause } from './propertyTypes';

export function locationFilter(loc: string): string {
  const safe = loc.replace(/`/g, '');
  return `(City:=\`${safe}\` || CityRegion:=\`${safe}\`)`;
}

function combine(...clauses: (string | undefined)[]): string {
  return clauses.filter(Boolean).join(' && ');
}

/** Top-N listings for one board within one location. */
export async function fetchBoard(
  board: BoardDef,
  loc: string,
  perPage = 5
): Promise<ListingDocument[]> {
  const res = await searchListings({
    query: '*',
    rawFilterBy: combine(locationFilter(loc), board.rawFilterBy),
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

/** Exact, point-in-time stats for a location (no time-series — see plan §deferred). */
export async function fetchRegionStats(loc: string): Promise<RegionStats> {
  const [active, cap, suite] = await Promise.all([
    searchListings({
      query: '*',
      rawFilterBy: combine(locationFilter(loc), 'ListPrice:>0'),
      perPage: 0,
    }),
    searchListings({
      query: '*',
      rawFilterBy: combine(locationFilter(loc), 'ExtrapolatedCapRate:>0'),
      sortBy: 'ExtrapolatedCapRate',
      sortOrder: 'desc',
      perPage: 1,
    }),
    searchListings({
      query: '*',
      rawFilterBy: combine(locationFilter(loc), 'SuiteScore:>=3'),
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
export function buildActivityFilter(loc: string, lens: MarketActivityLens): string {
  const cutoff = Date.now() - lens.windowDays * DAY_MS;
  return combine(
    locationFilter(loc),
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

/** Count of newly-listed active properties for a location under the lens. */
export async function fetchNewCount(loc: string, lens: MarketActivityLens): Promise<number> {
  const res = await searchListings({
    query: '*',
    rawFilterBy: buildActivityFilter(loc, lens),
    perPage: 0,
  });
  return res.totalFound;
}

/** Newest-first list of new active listings (capped at 100 — TRREB §6.3(b)). */
export async function fetchNewListings(
  loc: string,
  lens: MarketActivityLens,
  limit = 5
): Promise<ListingDocument[]> {
  const res = await searchListings({
    query: '*',
    rawFilterBy: buildActivityFilter(loc, lens),
    sortBy: 'EntryTimestamp',
    sortOrder: 'desc',
    perPage: Math.min(limit, 100),
  });
  return res.listings;
}
