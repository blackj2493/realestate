"use client";

import React from "react";
import { Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { CORE_FILTERS, FILTERS_BY_KEY } from "@/lib/filters/filterRegistry";
import { PERSONA_CONFIG, defaultTerminalFilters } from "@/lib/personas/personaConfig";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import FilterChip from "./FilterChip";
import InvestorChip from "./InvestorChip";
import PresetChip from "./PresetChip";
import AddFilterPalette from "./AddFilterPalette";
import { Popover } from "@/components/ui/popover";
import { formatResultNudge } from "./filterNudge";
import { anyControlActive } from "./investorControls";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const freshDefault = (v: FilterValue): FilterValue =>
  Array.isArray(v) ? ([...v] as FilterValue) : v;

/**
 * Unified instrument bar: a gold persona-preset chip, the universal "what"
 * basics (price/beds/baths/type), the active persona's investor chips, any
 * user-added deeper filters, the "+ Add filter" palette and the narrow nudge.
 * Investor chips bind to the persona `filters` slice (unchanged query pipeline);
 * basics/added bind to `universalFilters`.
 */
export default function FilterBar() {
  const {
    universalFilters,
    setUniversalFilter,
    resetUniversalFilters,
    addedFilterKeys,
    removeAddedFilter,
    clearAddedFilters,
    searchResult,
    totalCount,
    activePersona,
    filters,
    setFilters,
  } = useCommandCenterStore();

  const nudge = formatResultNudge(searchResult?.listings.length ?? 0, totalCount);
  const controls = PERSONA_CONFIG[activePersona].controls;

  const addedDefs = addedFilterKeys
    .map((k) => FILTERS_BY_KEY[k])
    .filter((f): f is FilterDef => Boolean(f));

  const universalActive =
    CORE_FILTERS.some((d) => d.isActive(universalFilters[d.key] ?? d.defaultValue)) ||
    addedDefs.some((d) => d.isActive(universalFilters[d.key] ?? d.defaultValue));
  const investorActive = anyControlActive(controls, filters);
  const anyActive = universalActive || investorActive;

  // Clear the filter chips only — leaves the commute/school map lenses intact.
  const clearAll = () => {
    setFilters({ ...defaultTerminalFilters });
    resetUniversalFilters();
    clearAddedFilters();
  };

  return (
    <div className="no-scrollbar flex h-11 items-center gap-x-2 overflow-x-auto border-t border-slate-800 bg-slate-950 px-3">
      <PresetChip />
      <div className="h-5 w-px shrink-0 bg-slate-800" />

      {CORE_FILTERS.map((def) => (
        <FilterChip
          key={def.key}
          def={def}
          value={universalFilters[def.key] ?? def.defaultValue}
          onChange={(v) => setUniversalFilter(def.key, v)}
          onClear={() => setUniversalFilter(def.key, freshDefault(def.defaultValue))}
        />
      ))}

      <div className="h-5 w-px shrink-0 bg-slate-800" />
      {controls.map((c, i) => (
        <InvestorChip key={`${activePersona}-${i}`} control={c} />
      ))}

      {addedDefs.map((def) => (
        <FilterChip
          key={def.key}
          def={def}
          value={universalFilters[def.key] ?? def.defaultValue}
          onChange={(v) => setUniversalFilter(def.key, v)}
          onClear={() => {
            setUniversalFilter(def.key, freshDefault(def.defaultValue));
            removeAddedFilter(def.key);
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

      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
        {anyActive && (
          <button
            onClick={clearAll}
            className={cn(
              LABEL,
              "flex items-center gap-1.5 border border-slate-700 px-2 py-1 text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
            )}
          >
            Clear
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        <span className={cn(LABEL, nudge.overflowing ? "text-amber-400" : "text-slate-400")}>
          {nudge.text}
        </span>
      </div>
    </div>
  );
}
