/**
 * Dashboard data helpers — thin wrappers over the client-side Typesense search.
 *
 * A "location" is a user-chosen market area. It can be a municipality (Typesense
 * `City`) or a neighbourhood (`CityRegion`), so every query matches BOTH. Values are
 * backtick-quoted because names contain spaces (e.g. "Richmond Hill", "Stoney Creek").
 */

import { searchListings, type ListingDocument } from '@/lib/typesense/client';
import type { BoardDef } from './boards';

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

/** Highest EntryTimestamp currently indexed for a location (epoch, unit unknown). */
export async function fetchMaxEntryTimestamp(loc: string): Promise<number | null> {
  const res = await searchListings({
    query: '*',
    rawFilterBy: locationFilter(loc),
    sortBy: 'EntryTimestamp',
    sortOrder: 'desc',
    perPage: 1,
  });
  const v = res.listings[0]?.EntryTimestamp;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Count of listings newer than a previously-seen EntryTimestamp watermark. */
export async function fetchCountNewerThan(loc: string, sinceTs: number): Promise<number> {
  const res = await searchListings({
    query: '*',
    rawFilterBy: combine(locationFilter(loc), `EntryTimestamp:>${Math.floor(sinceTs)}`),
    perPage: 0,
  });
  return res.totalFound;
}
