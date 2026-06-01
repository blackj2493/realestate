"use client";

import React from "react";
import { Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { CORE_FILTERS, FILTERS_BY_KEY, makePriceDef } from "@/lib/filters/filterRegistry";
import { isInvestorLayerActive, typeOptionsForClass, priceConfig } from "@/lib/filters/fundamentals";
import { PERSONA_CONFIG, defaultTerminalFilters } from "@/lib/personas/personaConfig";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import FilterChip from "./FilterChip";
import FundamentalToggle from "./FundamentalToggle";
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
    transactionMode,
    setTransactionMode,
    propertyClass,
    setPropertyClass,
  } = useCommandCenterStore();

  const nudge = formatResultNudge(searchResult?.listings.length ?? 0, totalCount);
  const controls = PERSONA_CONFIG[activePersona].controls;

  // The persona/investor layer (preset + investor chips) is residential-sale only.
  const investorLayer = isInvestorLayerActive(transactionMode, propertyClass);

  // Price slider follows the transaction mode (sale 0–3M vs rent 0–$12k bounds).
  const scopedPriceDef = makePriceDef(priceConfig(transactionMode));

  // Property Type picker: same generic FilterChip, but the option set (and the
  // single-select chip label) follow the chosen class. Value/clause stay on the
  // `homeType` universal filter, so reset + live counts + query are unchanged.
  const typeOptions = typeOptionsForClass(propertyClass);
  const homeTypeDef = FILTERS_BY_KEY.homeType;
  const scopedTypeDef: FilterDef = {
    ...homeTypeDef,
    options: typeOptions,
    chipLabel: (v) => {
      const vals = v as string[];
      if (!vals.length) return homeTypeDef.label;
      if (vals.length === 1) return typeOptions.find((o) => o.value === vals[0])?.label ?? vals[0];
      return `${vals.length} types`;
    },
  };

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
      {/* Fundamental axes — gate the whole query (sit before the persona preset). */}
      <FundamentalToggle
        ariaLabel="Transaction type"
        value={transactionMode}
        onChange={setTransactionMode}
        options={[
          { value: "sale", label: "For Sale" },
          { value: "rent", label: "For Rent" },
        ]}
      />
      <FundamentalToggle
        ariaLabel="Property class"
        value={propertyClass}
        onChange={setPropertyClass}
        options={[
          { value: "residential", label: "Residential" },
          { value: "commercial", label: "Commercial" },
        ]}
      />
      <div className="h-5 w-px shrink-0 bg-slate-800" />

      {/* Persona preset — residential-sale only (rent/commercial = basic browse). */}
      {investorLayer && (
        <>
          <PresetChip />
          <div className="h-5 w-px shrink-0 bg-slate-800" />
        </>
      )}

      {CORE_FILTERS.map((def) => {
        const useDef =
          def.key === "homeType" ? scopedTypeDef : def.key === "price" ? scopedPriceDef : def;
        return (
          <FilterChip
            key={def.key}
            def={useDef}
            value={universalFilters[def.key] ?? useDef.defaultValue}
            onChange={(v) => setUniversalFilter(def.key, v)}
            onClear={() => setUniversalFilter(def.key, freshDefault(useDef.defaultValue))}
          />
        );
      })}

      {investorLayer && (
        <>
          <div className="h-5 w-px shrink-0 bg-slate-800" />
          {controls.map((c, i) => (
            <InvestorChip key={`${activePersona}-${i}`} control={c} />
          ))}
        </>
      )}

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
