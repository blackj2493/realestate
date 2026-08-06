// src/lib/reno/eligibilityEvidence.ts
//
// Local EVIDENCE for the "what your home could become" rows — the part that turns three
// static Ontario rules into something only this site can show.
//
// What it deliberately does NOT do: quote one rent for "a suite". We don't know how big a
// basement the owner would build, and the local leased grid prices a 1-bed in-home unit
// ~$400/mo below a 2-bed. A single blended median was a number nobody could act on. So we
// report what is actually knowable and checkable:
//   • how many second units have really been LEASED nearby (proof the demand exists), and
//     the rent RANGE across sizes, explicitly size-dependent;
//   • how many plex-type homes have really SOLD nearby (proof the conversion market exists).
// Both are read off the same two grids already on the page, so a reader can verify every
// figure by scrolling up.
//
// Deterministic aggregation only — no AI (CLAUDE.md §4). Silent-null per row: a row with
// no local data simply shows its rule, as before.

import { IN_HOME_UNIT_LABEL, type AskingMatrix } from '@/lib/address/nearbyForSale';

/** In-home units below this are rooms, not units — they'd distort the low end of the range. */
const MIN_PLAUSIBLE_RENT = 700;

/** Board spellings that mean "already more than one dwelling in it". */
const PLEX_RE = /duplex|triplex|fourplex|multiplex/i;

export interface EligibilityEvidence {
  /** Second units actually leased in the radius. */
  suiteLeases: number;
  /** Rent range across the sizes that leased (low = smallest size, high = largest). */
  suiteRentLow: number | null;
  suiteRentHigh: number | null;
  /** 'leased' = achieved rents (consumer); 'asking' = live listings (anon). */
  suiteSource: 'leased' | 'asking' | null;
  /** Plex-type homes actually sold in the radius — the "3–4 units by right" evidence. */
  plexSales: number;
  plexSource: 'sold' | 'asking' | null;
  /** Radius both grids were drawn from (km). */
  radiusKm: number | null;
}

/**
 * Read the two grids for what they can prove about second units and plexes nearby.
 * Returns null when neither side has anything to say.
 */
export function deriveEligibilityEvidence({
  rentMatrix,
  rentSource,
  sellMatrix,
  sellSource,
  radiusKm,
}: {
  rentMatrix?: AskingMatrix | null;
  rentSource?: 'leased' | 'asking' | null;
  sellMatrix?: AskingMatrix | null;
  sellSource?: 'sold' | 'asking' | null;
  radiusKm?: number | null;
}): EligibilityEvidence | null {
  // ── second units: count + the rent range across sizes ──
  let suiteLeases = 0;
  const suiteRents: number[] = [];
  const suiteRow = rentMatrix?.rows.find((r) => r.label === IN_HOME_UNIT_LABEL);
  for (const cell of suiteRow?.cells ?? []) {
    if (!cell || cell.median == null || cell.median < MIN_PLAUSIBLE_RENT || cell.count <= 0) continue;
    suiteLeases += cell.count;
    suiteRents.push(cell.median);
  }

  // ── plexes: every row whose type already carries more than one dwelling ──
  let plexSales = 0;
  for (const row of sellMatrix?.rows ?? []) {
    if (!PLEX_RE.test(row.label)) continue;
    for (const cell of row.cells) {
      if (cell && cell.median != null && cell.count > 0) plexSales += cell.count;
    }
  }

  if (suiteLeases === 0 && plexSales === 0) return null;

  return {
    suiteLeases,
    suiteRentLow: suiteRents.length ? Math.min(...suiteRents) : null,
    suiteRentHigh: suiteRents.length ? Math.max(...suiteRents) : null,
    suiteSource: suiteLeases > 0 ? (rentSource === 'leased' ? 'leased' : 'asking') : null,
    plexSales,
    plexSource: plexSales > 0 ? (sellSource === 'sold' ? 'sold' : 'asking') : null,
    radiusKm: radiusKm ?? null,
  };
}
