// src/lib/reno/suiteEconomics.ts
//
// The renovation guide's money answer: what a second unit would actually EARN here.
//
// The guide could tell an owner that Ontario lets them add a suite (Bill 23) and what it
// would cost to build — but never what it would pay, which is the only number that
// decides it. We already hold both halves: the LEASED beds × type grid carries a
// "Basement / in-home unit" row (real in-home rentals within 2 km), and the value-add
// engine prices the legal-suite move. Put them together and the guide answers the
// question an owner is actually asking: does a suite pay for itself, and how fast?
//
// Deterministic arithmetic only — no AI (CLAUDE.md §4). Silent-null: when the local
// leased grid has no in-home-unit row, we return null and the section self-hides rather
// than quoting a whole-home rent as if a basement would fetch it.

import { IN_HOME_UNIT_LABEL, type AskingMatrix } from '@/lib/address/nearbyForSale';
import type { RenoMoveLike } from './insights';

/** Suites cheaper than this are almost certainly mis-keyed rooms, not units. */
const MIN_PLAUSIBLE_RENT = 700;

export interface SuiteEconomics {
  /** Median monthly rent for an in-home unit nearby. */
  monthlyRent: number;
  annualRent: number;
  /** Leases behind the median — the honesty device. */
  sampleCount: number;
  /** 'leased' = achieved rents (consumer); 'asking' = live listings (anon). */
  rentSource: 'leased' | 'asking';
  /** Build cost range for a LEGAL suite, from the value-add engine's move. */
  costLow: number;
  costHigh: number;
  /** Years of rent to cover the build, at each end of the cost range. */
  paybackFastYears: number;
  paybackSlowYears: number;
  /** Resale value the engine attributes to the suite (VOW-derived; null when locked). */
  resaleAdd: number | null;
}

/** Median of the in-home-unit row, weighted by each bedroom cell's sample count. */
function inHomeUnitRent(matrix: AskingMatrix | null | undefined): { rent: number; count: number } | null {
  const row = matrix?.rows.find((r) => r.label === IN_HOME_UNIT_LABEL);
  if (!row) return null;
  let weighted = 0;
  let n = 0;
  for (const cell of row.cells) {
    if (!cell || cell.median == null || cell.median < MIN_PLAUSIBLE_RENT || cell.count <= 0) continue;
    weighted += cell.median * cell.count;
    n += cell.count;
  }
  if (n === 0) return null;
  return { rent: Math.round(weighted / n), count: n };
}

/**
 * Combine the local in-home-unit rent with the legal-suite move's cost and resale value.
 * Returns null unless BOTH sides are present — a payback period needs a cost as much as
 * it needs a rent.
 */
export function deriveSuiteEconomics({
  rentMatrix,
  rentSource,
  moves,
}: {
  rentMatrix: AskingMatrix | null | undefined;
  rentSource: 'leased' | 'asking' | null | undefined;
  moves: RenoMoveLike[];
}): SuiteEconomics | null {
  const local = inHomeUnitRent(rentMatrix);
  if (!local) return null;

  const suite = moves.find((m) => m.key === 'legal_suite');
  if (!suite || !(suite.costLow > 0) || !(suite.costHigh > 0)) return null;

  const annualRent = local.rent * 12;
  return {
    monthlyRent: local.rent,
    annualRent,
    sampleCount: local.count,
    rentSource: rentSource === 'leased' ? 'leased' : 'asking',
    costLow: suite.costLow,
    costHigh: suite.costHigh,
    paybackFastYears: suite.costLow / annualRent,
    paybackSlowYears: suite.costHigh / annualRent,
    resaleAdd: typeof suite.valueAddTyp === 'number' && suite.valueAddTyp > 0 ? suite.valueAddTyp : null,
  };
}

/** "2.2–5.3 years" / "about 3.4 years" — one payback string from the two ends. */
export function paybackRange(s: SuiteEconomics): string {
  const fast = s.paybackFastYears;
  const slow = s.paybackSlowYears;
  const fmt = (y: number) => (y >= 10 ? y.toFixed(0) : y.toFixed(1));
  return Math.abs(slow - fast) < 0.15 ? `about ${fmt(fast)} years` : `${fmt(fast)}–${fmt(slow)} years`;
}
