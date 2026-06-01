"use client";

import { useEffect, useMemo, useState } from "react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_CONFIG } from "@/lib/personas/personaConfig";
import { buildTerminalCoreClauses } from "@/lib/filters/terminalQuery";
import { buildBands, supportsHistogram, HISTOGRAM_BANDS } from "@/lib/filters/histogram";
import { searchHistogram } from "@/lib/typesense/client";

interface UseRangeHistogramArgs {
  /** Universal-filter key whose own clause is excluded from the histogram base. */
  filterKey: string;
  /** Typesense numeric field; if unsupported/undefined the hook no-ops. */
  field?: string;
  min: number;
  max: number;
  bands?: number;
  /** Investor-chip histograms drop the whole persona clause (see terminalQuery). */
  excludePersona?: boolean;
}

/**
 * Full-population distribution for one range slider, fetched on demand (the hook
 * only mounts when the slider's popover opens). The base filter mirrors the live
 * search via buildTerminalCoreClauses but drops this slider's own clause, so the
 * bars show where inventory sits across the dimension being dragged. Debounced so
 * adjusting other filters while open doesn't spam multi_search.
 */
export function useRangeHistogram({
  filterKey,
  field,
  min,
  max,
  bands = HISTOGRAM_BANDS,
  excludePersona,
}: UseRangeHistogramArgs) {
  const transactionMode = useCommandCenterStore((s) => s.transactionMode);
  const propertyClass = useCommandCenterStore((s) => s.propertyClass);
  const universalFilters = useCommandCenterStore((s) => s.universalFilters);
  const filters = useCommandCenterStore((s) => s.filters);
  const activePersona = useCommandCenterStore((s) => s.activePersona);

  const baseFilterBy = useMemo(
    () =>
      buildTerminalCoreClauses({
        transactionMode,
        propertyClass,
        universalFilters,
        filters,
        persona: PERSONA_CONFIG[activePersona],
        excludeUniversalKey: filterKey,
        excludePersona,
      }).join(" && "),
    [transactionMode, propertyClass, universalFilters, filters, activePersona, filterKey, excludePersona]
  );

  const [counts, setCounts] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Unsupported field ⇒ no fetch; counts stay [] and RangeControl hides the bars.
    if (!supportsHistogram(field)) return;
    const bandList = buildBands(min, max, bands);
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const c = await searchHistogram({ field, baseFilterBy, bands: bandList });
        if (!cancelled) setCounts(c);
      } catch {
        if (!cancelled) setCounts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [field, baseFilterBy, min, max, bands]);

  const maxCount = counts.length ? Math.max(...counts) : 0;
  return { counts, maxCount, loading };
}
