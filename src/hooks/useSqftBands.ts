"use client";

import { useEffect, useMemo, useState } from "react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { buildTerminalCoreClauses } from "@/lib/filters/terminalQuery";
import { sqftRangeClause, SQFT_UNSIZED_CLAUSE } from "@/lib/filters/filterRegistry";
import { bandsForScale, type SqftScale } from "@/lib/listings/livingAreaBands";
import { searchClauseCounts } from "@/lib/typesense/client";

export interface SqftBandCounts {
  /** Inventory per band of the displayed scale, bucketed by the band's floor. */
  perBand: number[];
  /** Listings whose whole band sits inside the selection. */
  certain: number;
  /** Listings whose band merely straddles a limit — certain matches excluded. */
  possible: number;
  /** Listings reporting no size at all. */
  unsized: number;
  loading: boolean;
}

const EMPTY: SqftBandCounts = {
  perBand: [],
  certain: 0,
  possible: 0,
  unsized: 0,
  loading: false,
};

/**
 * Live counts behind the sqft band control.
 *
 * Everything is measured against the same base the live search uses, minus the
 * sqft clause itself (`excludeUniversalKey`), so the bars show where inventory
 * actually sits across the dimension being dragged instead of collapsing onto
 * the current selection.
 *
 * `certain` and `possible` come from the SAME `sqftRangeClause` the search will
 * run, evaluated strict and loose. Deriving them from the bars instead would be
 * cheaper but wrong: bars bucket by the band's floor, which cannot see a band's
 * upper bound, and the whole point of the split is that the two TRREB
 * vocabularies disagree about where bands end.
 *
 * One debounced multi_search covers all of it — bands + 3 totals, ~12 count
 * queries on the freehold scale and ~24 on the condo scale, each `per_page: 0`.
 */
export function useSqftBands({
  scale,
  lo,
  hi,
  enabled = true,
}: {
  scale: SqftScale;
  lo: number;
  hi: number;
  enabled?: boolean;
}): SqftBandCounts {
  const transactionMode = useCommandCenterStore((s) => s.transactionMode);
  const propertyClass = useCommandCenterStore((s) => s.propertyClass);
  const universalFilters = useCommandCenterStore((s) => s.universalFilters);
  const filters = useCommandCenterStore((s) => s.filters);

  const baseFilterBy = useMemo(
    () =>
      buildTerminalCoreClauses({
        transactionMode,
        propertyClass,
        universalFilters,
        filters,
        excludeUniversalKey: "sqft",
      }).join(" && "),
    [transactionMode, propertyClass, universalFilters, filters]
  );

  const bands = useMemo(() => bandsForScale(scale), [scale]);
  const [state, setState] = useState<SqftBandCounts>(EMPTY);

  useEffect(() => {
    if (!enabled) return;

    const strict = sqftRangeClause(lo, hi, false);
    const loose = sqftRangeClause(lo, hi, true);
    // A wide-open range has no clause; "" counts the whole base, which is the
    // correct answer for both certain and possible in that case.
    // Bars bucket by the band's floor, so every sized listing lands in exactly
    // one bar. The TOP bar is deliberately open-ended: the last stop means "and
    // up" when selected, so its bar must count everything at or above its floor
    // too. Without that, the condo scale — which ends at 4,500 — would silently
    // omit ~2,800 larger listings that the top stop does in fact match.
    const lastIdx = bands.length - 1;
    const clauses = [
      ...bands.map((b, i) =>
        i === lastIdx ? `sqft_min:>=${b.lo}` : `sqft_min:>=${b.lo} && sqft_min:<${b.hi}`
      ),
      strict ?? "",
      loose ?? "",
      SQFT_UNSIZED_CLAUSE,
    ];

    let cancelled = false;
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const counts = await searchClauseCounts({ baseFilterBy, clauses });
        if (cancelled) return;
        const perBand = counts.slice(0, bands.length);
        const [certain, looseTotal, unsized] = counts.slice(bands.length);
        setState({
          perBand,
          certain: certain ?? 0,
          // Loose is a superset of strict, so the straddlers are the difference.
          // Clamped because the two counts are measured, not derived, and a
          // concurrent index write could otherwise show a negative.
          possible: Math.max(0, (looseTotal ?? 0) - (certain ?? 0)),
          unsized: unsized ?? 0,
          loading: false,
        });
      } catch {
        if (!cancelled) setState({ ...EMPTY });
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [enabled, baseFilterBy, bands, lo, hi]);

  return state;
}
