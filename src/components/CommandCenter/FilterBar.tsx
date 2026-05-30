"use client";

import React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { CORE_FILTERS, FILTERS_BY_KEY } from "@/lib/filters/filterRegistry";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import FilterChip from "./FilterChip";
import AddFilterPalette from "./AddFilterPalette";
import { Popover } from "@/components/ui/popover";
import { formatResultNudge } from "./filterNudge";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const freshDefault = (v: FilterValue): FilterValue =>
  Array.isArray(v) ? ([...v] as FilterValue) : v;

export default function FilterBar() {
  const {
    universalFilters,
    setUniversalFilter,
    addedFilterKeys,
    removeAddedFilter,
    searchResult,
    totalCount,
  } = useCommandCenterStore();
  const nudge = formatResultNudge(searchResult?.listings.length ?? 0, totalCount);

  // Pinned core chips, then any user-added chips (deduped, in add order).
  const addedDefs = addedFilterKeys
    .map((k) => FILTERS_BY_KEY[k])
    .filter((f): f is FilterDef => Boolean(f));
  const chips = [...CORE_FILTERS, ...addedDefs];

  return (
    <div className="no-scrollbar flex h-11 items-center gap-x-2 overflow-x-auto border-t border-slate-800 bg-slate-950 px-3">
      <span className={cn(LABEL, "shrink-0 text-slate-500")}>Filters</span>
      {chips.map((def) => (
        <FilterChip
          key={def.key}
          def={def}
          value={universalFilters[def.key] ?? def.defaultValue}
          onChange={(v) => setUniversalFilter(def.key, v)}
          onClear={() => {
            setUniversalFilter(def.key, freshDefault(def.defaultValue));
            if (!def.defaultPinned) removeAddedFilter(def.key);
          }}
        />
      ))}

      <Popover
        trigger={
          <span
            className={cn(
              LABEL,
              "flex shrink-0 cursor-pointer items-center gap-1 border border-dashed border-slate-700 px-2.5 py-1.5 text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
            )}
          >
            <Plus className="h-3 w-3" />
            Add filter
          </span>
        }
        className="p-2"
      >
        <AddFilterPalette />
      </Popover>

      <div className="ml-auto flex shrink-0 items-center pl-2">
        <span className={cn(LABEL, nudge.overflowing ? "text-amber-400" : "text-slate-400")}>
          {nudge.text}
        </span>
      </div>
    </div>
  );
}
