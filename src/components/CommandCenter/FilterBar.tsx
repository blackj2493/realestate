"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { CORE_FILTERS } from "@/lib/filters/filterRegistry";
import type { FilterValue } from "@/lib/filters/types";
import FilterChip from "./FilterChip";
import { formatResultNudge } from "./filterNudge";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const freshDefault = (v: FilterValue): FilterValue =>
  Array.isArray(v) ? ([...v] as FilterValue) : v;

export default function FilterBar() {
  const { universalFilters, setUniversalFilter, searchResult, totalCount } =
    useCommandCenterStore();
  const shown = searchResult?.listings.length ?? 0;
  const nudge = formatResultNudge(shown, totalCount);

  return (
    <div className="no-scrollbar flex h-11 items-center gap-x-2 overflow-x-auto border-t border-slate-800 bg-slate-950 px-3">
      <span className={cn(LABEL, "shrink-0 text-slate-500")}>Filters</span>
      {CORE_FILTERS.map((def) => (
        <FilterChip
          key={def.key}
          def={def}
          value={universalFilters[def.key] ?? def.defaultValue}
          onChange={(v) => setUniversalFilter(def.key, v)}
          onClear={() => setUniversalFilter(def.key, freshDefault(def.defaultValue))}
        />
      ))}
      <div className="ml-auto flex shrink-0 items-center pl-2">
        <span className={cn(LABEL, nudge.overflowing ? "text-amber-400" : "text-slate-400")}>
          {nudge.text}
        </span>
      </div>
    </div>
  );
}
