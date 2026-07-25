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
import type { BasementFilter, MarketActivityLens } from './config';
import { typesensePropertyTypeClause } from './propertyTypes';
import { areaFilter, type Area } from './area';
import { aboveGradeBedsClause, exactAboveGradeBedsClause } from '@/lib/filters/filterRegistry';

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

/** Top-N listings for one board within one area, scoped by the global lens. */
export async function fetchBoard(
  board: BoardDef,
  area: Area,
  lens: MarketActivityLens,
  perPage = 5
): Promise<ListingDocument[]> {
  const res = await searchListings({
    query: '*',
    rawFilterBy: combine(buildScopeFilter(area, lens), board.rawFilterBy),
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

/** Exact, point-in-time stats for an area, scoped by the global lens. */
export async function fetchRegionStats(
  area: Area,
  lens: MarketActivityLens
): Promise<RegionStats> {
  const scope = buildScopeFilter(area, lens);
  const [active, cap, suite] = await Promise.all([
    searchListings({ query: '*', rawFilterBy: scope, perPage: 0 }),
    searchListings({
      query: '*',
      rawFilterBy: combine(scope, 'cap_rate_est:>=1 && cap_rate_est:<=15'),
      sortBy: 'cap_rate_est',
      sortOrder: 'desc',
      perPage: 1,
    }),
    searchListings({
      query: '*',
      rawFilterBy: combine(scope, 'SuiteScore:>=3'),
      perPage: 0,
    }),
  ]);
  return {
    activeCount: active.totalFound,
    topCapRate: cap.listings[0]?.cap_rate_est ?? null,
    suiteCandidates: suite.totalFound,
  };
}

/**
 * Active-inventory SHARES that back the persona specialty headline tiles.
 *
 * Each field is a full-population COUNT (Typesense `found`) — counting matches is
 * not "displaying listings", so the §6.3(b) 100-row DISPLAY cap does not apply
 * (same reasoning as /api/market/region-stats). The comparison band turns each
 * count into a share of active inventory, which (unlike a raw count) is
 * comparable across markets of very different sizes. All deterministic (§4).
 *
 * Why shares and not e.g. a regional median carry: CapitalBurnRateMonthly is not
 * faceted in the Typesense schema, so there's no cheap full-population aggregate
 * for it — and sampling the top-N would bias the figure. Counts of a filterable
 * flag are exact and cheap.
 */
export interface RegionSpecialtyStats {
  /** Priced active listings — the denominator for every share below. */
  activeCount: number;
  /** is_density_ready listings (surplus parking + detached) — builder supply. */
  densityReadyCount: number;
  /** Listings carrying a price cut from their first-seen price — motivated sellers. */
  priceCutCount: number;
  /** Listings whose cap_rate_est clears the cashflow floor. */
  cashflowCount: number;
}

/** cap_rate_est (%) at/above which a listing "pencils" for a cashflow buyer. */
export const CASHFLOW_CAP_FLOOR = 4.5;

/** Count-only Typesense query (perPage:0 → just the `found` total). */
async function countMatching(filter: string): Promise<number> {
  const res = await searchListings({ query: '*', rawFilterBy: filter, perPage: 0 });
  return res.totalFound;
}

/** Specialty inventory shares for an area, scoped by the global lens. */
export async function fetchRegionSpecialty(
  area: Area,
  lens: MarketActivityLens
): Promise<RegionSpecialtyStats> {
  const scope = buildScopeFilter(area, lens);
  const [active, density, priceCut, cashflow] = await Promise.all([
    countMatching(scope),
    countMatching(combine(scope, 'is_density_ready:=true')),
    countMatching(combine(scope, 'TotalPriceDrop:>0')),
    countMatching(combine(scope, `cap_rate_est:>=${CASHFLOW_CAP_FLOOR} && cap_rate_est:<=15`)),
  ]);
  return {
    activeCount: active,
    densityReadyCount: density,
    priceCutCount: priceCut,
    cashflowCount: cashflow,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// BasementType values that indicate finished living space — mirrors the sold-feed
// derivation (deriveHasFinishedBasement: any "apartment" or non-"unfinished"
// "finished" token). Exact "Finished" alone misses Apartment / walk-out / partial.
const FINISHED_BASEMENT_VALUES = [
  'Finished',
  'Apartment',
  'Finished with Walk-Out',
  'Partially Finished',
];

// The canonical "no finished space" token on the active (IDX) BasementType field.
// The sold side has no BasementType — it bands the integer BasementTier instead
// (see soldFilter.ts) — so the two collections express "unfinished" differently.
const UNFINISHED_BASEMENT_VALUES = ['Unfinished'];

function basementTypeClause(values: string[]): string {
  const ors = values.map((v) => `BasementType:=\`${v}\``);
  return `(${ors.join(' || ')})`;
}

/** Active-side basement clause, or undefined for the unconstrained `any`. */
function basementClause(basement: BasementFilter): string | undefined {
  if (basement === 'finished') return basementTypeClause(FINISHED_BASEMENT_VALUES);
  if (basement === 'unfinished') return basementTypeClause(UNFINISHED_BASEMENT_VALUES);
  return undefined;
}

/**
 * Sale-vs-lease scope via the indexed `TransactionType` facet (added to the live
 * collection by scripts/admin/add-transaction-type.ts). Exact — replaces the old
 * ListPrice ($50k) proxy. The handful of docs with a blank TransactionType match
 * neither and are correctly excluded from both views.
 */
function transactionClause(lens: MarketActivityLens): string {
  return lens.transactionType === 'lease'
    ? 'TransactionType:=`For Lease`'
    : 'TransactionType:=`For Sale`';
}

/**
 * The global active-inventory SCOPE — every "what kind of property" dimension of
 * the lens (sale/lease, type, beds, baths, parking, finished basement, frontage),
 * but NOT the time window (that is activity-only). This is the single filter that
 * every active-inventory surface AND-joins so a city or a custom bubble shows one
 * coherent slice instead of a mix of rentals, condos and 4-beds.
 */
/**
 * The LENS-ONLY clause set (no area, no window) — the dashboard filter semantics
 * as one reusable fragment. Shared by buildScopeFilter below AND the nightly
 * alerts worker (bubbleFilterClause), so a city bubble's 'filtered' alerts match
 * exactly what the dashboard's own panels show under the same lens.
 */
export function buildLensClauses(lens: MarketActivityLens): string {
  return combine(
    transactionClause(lens),
    typesensePropertyTypeClause(lens.propertyTypes),
    // Beds: above-grade with a total fallback — identical semantics to the For Sale
    // filter (filterRegistry) and the sold lens (soldFilter). "4 beds" means 4 ABOVE
    // grade, so a "2+2" basement home no longer surfaces under it, keeping the active
    // scope consistent with the sold scope and the card's bedsLabel split.
    lens.minBeds > 0
      ? (lens.bedsExact ? exactAboveGradeBedsClause(lens.minBeds) : aboveGradeBedsClause(lens.minBeds))
      : undefined,
    lens.minBaths > 0 ? `BathroomsTotalInteger:${lens.bathsExact ? '=' : '>='}${lens.minBaths}` : undefined,
    lens.minGarage > 0 ? `ParkingTotal:${lens.garageExact ? '=' : '>='}${lens.minGarage}` : undefined,
    basementClause(lens.basement),
    lens.minFrontage > 0 ? `LotWidth:>=${lens.minFrontage}` : undefined
  );
}

export function buildScopeFilter(area: Area, lens: MarketActivityLens): string {
  return combine(areaFilter(area), buildLensClauses(lens));
}

/**
 * Scope filter PLUS an absolute "entered since" cutoff (epoch ms).
 * `buildActivityFilter` is the rolling-window special case; the action feed passes
 * the user's previous-visit timestamp instead.
 */
export function buildSinceFilter(
  area: Area,
  lens: MarketActivityLens,
  sinceMs: number
): string {
  return combine(buildScopeFilter(area, lens), `EntryTimestamp:>=${Math.floor(sinceMs)}`);
}

/**
 * Rolling-window "new active listings in the last N days". This collection has no
 * usable `Status:=Active` flag (it stores TRREB MlsStatus sub-states), so the whole
 * IDX index is treated as active and scoped by the EntryTimestamp window only —
 * `EntryTimestamp` is in MILLISECONDS (transformer.ts).
 */
export function buildActivityFilter(area: Area, lens: MarketActivityLens): string {
  return buildSinceFilter(area, lens, Date.now() - lens.windowDays * DAY_MS);
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

/**
 * Action-feed source: newest-first listings entered SINCE the user's last visit,
 * optionally narrowed by `extraFilter` (the active persona's lead-board clause, so
 * "new" means "new AND relevant to how this user invests"). Newest-first, capped
 * at 100 (TRREB §6.3(b)).
 */
export async function fetchNewSinceVisit(
  area: Area,
  lens: MarketActivityLens,
  sinceMs: number,
  opts: { extraFilter?: string; limit?: number } = {}
): Promise<ListingDocument[]> {
  const { extraFilter, limit = 10 } = opts;
  const res = await searchListings({
    query: '*',
    rawFilterBy: combine(buildSinceFilter(area, lens, sinceMs), extraFilter),
    sortBy: 'EntryTimestamp',
    sortOrder: 'desc',
    perPage: Math.min(limit, 100),
  });
  return res.listings;
}
