// src/lib/reno/cohort.ts
//
// "Homes LIKE YOURS" — the beds × property-type cell behind the renovation tool's
// price ceiling and its market card.
//
// The tool models a TYPICAL home (3 bed / 2 bath) unless the owner adds their details,
// so an area-wide median or the generic AVM band answered a question nobody asked: a
// 5-bed detached owner was being shown a 3-bed ceiling. This module reuses the SAME
// beds × type matrix the listing/address pages render (buildBedsTypeMatrix over the
// 2 km→5 km sold/asking pool) and pulls the single cell that matches the home in front
// of us — with an honest record of how close the match actually is.
//
// PURE + client-safe (no server imports): the fetching lives in /api/reno/cohort.
// Deterministic selection only — no AI (CLAUDE.md §4).

import { normalizePropertySubType } from '@/lib/avm/normalizeType';
import type { AskingMatrix } from '@/lib/address/nearbyForSale';

/** How closely the cell we found matches the home being modelled. */
export type CohortBasis =
  /** exact bedroom count AND property type */
  | 'exact'
  /** right type, nearest bedroom count that had data */
  | 'nearest-beds'
  /** right type, pooled across bedroom counts */
  | 'type';

export interface CohortCell {
  median: number;
  p25: number | null;
  p75: number | null;
  /** Sales/listings behind the number — the honesty device. */
  count: number;
  /** The bedroom bucket the number actually describes (6 = "6+"). */
  beds: number;
  basis: CohortBasis;
  /** Row label as filed by the board, e.g. "Detached", "Att/Row/Townhouse". */
  typeLabel: string;
}

/** The full beds × type grid for one side of the market, as MarketGrids consumes it. */
export interface CohortGrid<S extends string> {
  matrix: AskingMatrix;
  radiusKm: number;
  source: S;
}

export interface RenoCohort {
  /** Sale side: actual closes (consumer) or live asking prices (anon) — always labelled. */
  sell: CohortGrid<'sold' | 'asking'> | null;
  /** Rent side: achieved leases (consumer) or asking rents (anon). */
  rent: CohortGrid<'leased' | 'asking'> | null;
}

/** Bedroom label used in copy: 0 → "Studio", 6 → "6+". */
export function bedsLabel(beds: number): string {
  if (beds <= 0) return 'Studio';
  if (beds >= 6) return '6+ bed';
  return `${beds} bed`;
}

/**
 * Pull the cell describing a `beds`-bedroom `subType` home out of a beds × type matrix.
 *
 * Match order, widening only as far as it must:
 *   1. the exact (type, beds) cell,
 *   2. the same type at the NEAREST bedroom count that has data (ties → the larger home,
 *      since bed counts skew small in these pools),
 *   3. the type pooled across bedroom counts (count-weighted median of its cells).
 * Returns null when the type isn't represented at all — the caller then says nothing
 * rather than quoting a number about some other kind of home.
 */
export function pickCohortCell(
  matrix: AskingMatrix | null | undefined,
  subType: string,
  beds: number,
): CohortCell | null {
  if (!matrix || !matrix.rows.length) return null;
  const want = normalizePropertySubType(subType);
  if (!want) return null;

  const row = matrix.rows.find((r) => normalizePropertySubType(r.label) === want);
  if (!row) return null;

  const target = Math.max(0, Math.min(6, Math.round(beds)));
  const withData = matrix.bedCols
    .map((b, i) => ({ b, cell: row.cells[i] }))
    .filter((x) => x.cell && x.cell.median != null && x.cell.median > 0);
  if (!withData.length) return null;

  const exact = withData.find((x) => x.b === target);
  if (exact) {
    return {
      median: exact.cell.median!,
      p25: exact.cell.p25 ?? null,
      p75: exact.cell.p75 ?? null,
      count: exact.cell.count,
      beds: exact.b,
      basis: 'exact',
      typeLabel: row.label,
    };
  }

  // Nearest bedroom count; on a tie prefer the LARGER home (a 4-bed read is the safer
  // ceiling for a 3.5-equivalent than a 3-bed one).
  const nearest = [...withData].sort(
    (x, y) => Math.abs(x.b - target) - Math.abs(y.b - target) || y.b - x.b,
  )[0];
  if (Math.abs(nearest.b - target) <= 1) {
    return {
      median: nearest.cell.median!,
      p25: nearest.cell.p25 ?? null,
      p75: nearest.cell.p75 ?? null,
      count: nearest.cell.count,
      beds: nearest.b,
      basis: 'nearest-beds',
      typeLabel: row.label,
    };
  }

  // Too far to call it a bedroom match — pool the whole type instead.
  let weighted = 0;
  let n = 0;
  for (const x of withData) {
    weighted += x.cell.median! * x.cell.count;
    n += x.cell.count;
  }
  if (n === 0) return null;
  return {
    median: Math.round(weighted / n),
    p25: null,
    p75: null,
    count: n,
    beds: target,
    basis: 'type',
    typeLabel: row.label,
  };
}

/**
 * The whole type row pooled across bedroom counts — the honest read when we DON'T know
 * how big the home is (the tool models a typical 3-bed unless the owner says otherwise,
 * so quoting a 3-bed ceiling to a 5-bed owner would be worse than saying nothing about
 * size at all). Count-weighted median; no p25/p75, because a band across mixed sizes
 * describes the stock, not a home.
 */
export function pickTypeRow(
  matrix: AskingMatrix | null | undefined,
  subType: string,
): CohortCell | null {
  if (!matrix || !matrix.rows.length) return null;
  const want = normalizePropertySubType(subType);
  if (!want) return null;
  const row = matrix.rows.find((r) => normalizePropertySubType(r.label) === want);
  if (!row) return null;

  let weighted = 0;
  let n = 0;
  for (const cell of row.cells) {
    if (!cell || cell.median == null || cell.median <= 0 || cell.count <= 0) continue;
    weighted += cell.median * cell.count;
    n += cell.count;
  }
  if (n === 0) return null;
  return {
    median: Math.round(weighted / n),
    p25: null,
    p75: null,
    count: n,
    beds: -1, // no bedroom claim
    basis: 'type',
    typeLabel: row.label,
  };
}

/** "3 bed Detached" / "Detached (any size)" — how a cell should be described in copy. */
export function cohortLabel(cell: CohortCell, typeLabel: string): string {
  const type = typeLabel || cell.typeLabel;
  return cell.basis === 'type' ? `${type} (any size)` : `${bedsLabel(cell.beds)} ${type.toLowerCase()}`;
}
