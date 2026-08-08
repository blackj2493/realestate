"use client";

import React from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { FILTERS_BY_KEY, makePriceDef, coreFiltersForClass, moreFiltersForClass } from "@/lib/filters/filterRegistry";
import { isInvestorLayerActive, typeOptionsForClass, priceConfig } from "@/lib/filters/fundamentals";
import { PERSONA_CONFIG, INVESTOR_CONTROLS, defaultTerminalFilters } from "@/lib/personas/personaConfig";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import FilterChip from "./FilterChip";
import FundamentalToggle from "./FundamentalToggle";
import SoldWindowDropdown from "./SoldWindowDropdown";
import LayerChips from "./LayerChips";
import MobileFilterSheet from "./MobileFilterSheet";
import FilterDrawer from "./FilterDrawer";
import ActiveFilterStrip from "./ActiveFilterStrip";
import { buildFilterTokens } from "./filterTokens";
import { formatResultNudge } from "./filterNudge";
import { anyControlActive, isControlActive, controlId } from "./investorControls";
import { SCHOOL_LEVEL_LABEL } from "@/lib/schools/schoolLens";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const freshDefault = (v: FilterValue): FilterValue =>
  Array.isArray(v) ? ([...v] as FilterValue) : v;

/**
 * Unified instrument bar: the universal "what"
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
    setFilter,
    setFilters,
    transactionMode,
    activeLayers,
    propertyClass,
    setPropertyClass,
    school,
    resetSchool,
    commute,
    resetCommute,
    amenity,
    resetAmenity,
  } = useCommandCenterStore();

  // Global map lenses (school / commute / walkability) — not universal filters, so they
  // need to be surfaced as their own removable tokens (and cleared on "Clear all"),
  // otherwise e.g. a "School ≥ 9.0" applied by a natural-language search lingers invisibly.
  const lenses = [
    {
      id: "school",
      active: school.enabled && (school.minScore > 0 || !!school.targetSchool),
      label: school.targetSchool
        ? `Near ${school.targetSchool.name}`
        : `${SCHOOL_LEVEL_LABEL[school.level]} school ≥ ${school.minScore.toFixed(1)}`,
      onRemove: resetSchool,
    },
    {
      id: "commute",
      active: commute.enabled && !!commute.destination,
      label: commute.destination ? `${commute.minutes}-min ${commute.mode} → ${commute.destination.label}` : "",
      onRemove: resetCommute,
    },
    {
      id: "amenity",
      active: amenity.enabled,
      label: `${amenity.kind === "grocery" ? "Grocery" : amenity.kind === "recreation" ? "Recreation" : "Amenity"} ≤ ${amenity.maxKm}km`,
      onRemove: resetAmenity,
    },
  ];

  const nudge = formatResultNudge(searchResult?.listings.length ?? 0, totalCount);
  // The active persona PINS this subset; every other investor signal stays reachable
  // via "+ Add filter" (moreControls), and the query/strip operate over the FULL
  // catalog so a signal set under any persona keeps applying + showing.
  const controls = PERSONA_CONFIG[activePersona].controls;
  const personaControlIds = new Set(controls.map(controlId));
  const moreControls = INVESTOR_CONTROLS.filter((c) => !personaControlIds.has(controlId(c)));

  // Comp-only = no active (sale/rent) layer lit → hide the active-browse controls.
  const compOnly = !activeLayers.has("forSale") && !activeLayers.has("forRent");

  // The persona/investor layer (preset + investor chips) is residential-sale only.
  const investorLayer = !compOnly && isInvestorLayerActive(transactionMode, propertyClass);

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

  // Class-scoped filter sets: commercial hides the residential-only fields (beds/baths,
  // basement, kitchens, suite, exposure) from every surface — bar, drawer, mobile sheet.
  // Zero RAM: these are all already-indexed fields; we're just choosing which to show
  // per class (and terminalQuery drops the hidden ones from the query to match).
  const coreFilters = coreFiltersForClass(propertyClass);
  const moreFilters = moreFiltersForClass(propertyClass);

  const addedDefs = addedFilterKeys
    .map((k) => FILTERS_BY_KEY[k])
    .filter((f): f is FilterDef => Boolean(f))
    // Drop residential-only added chips in commercial mode (they'd be inert — the query
    // excludes them — so showing them would just mislead).
    .filter((f) => moreFilters.some((m) => m.key === f.key));

  const universalActive =
    coreFilters.some((d) => d.isActive(universalFilters[d.key] ?? d.defaultValue)) ||
    addedDefs.some((d) => d.isActive(universalFilters[d.key] ?? d.defaultValue));
  const investorActive = anyControlActive(INVESTOR_CONTROLS, filters);
  const lensActive = lenses.some((l) => l.active);
  const anyActive = universalActive || investorActive || lensActive;

  // Clear EVERYTHING the user is filtering by — universal chips, investor controls, AND
  // the global map lenses (school / commute / walkability). The lenses used to survive
  // this, which left e.g. a search-applied "School ≥ 9.0" stuck on with no way to clear it.
  const clearAll = () => {
    setFilters({ ...defaultTerminalFilters });
    resetUniversalFilters();
    clearAddedFilters();
    resetSchool();
    resetCommute();
    resetAmenity();
  };

  // Mobile (<md): the inline chip row scrolls its controls off the right edge,
  // so the bar collapses to a "Filters" button that opens MobileFilterSheet.
  // Build the render-ready item lists once and share them with the sheet.
  const [sheetOpen, setSheetOpen] = React.useState(false);
  // Desktop: the deep field library + investor signals live in a right-side drawer
  // behind a single count-badged button, instead of overflowing the bar.
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const coreItems = coreFilters.map((def) => {
    const useDef =
      def.key === "homeType" ? scopedTypeDef : def.key === "price" ? scopedPriceDef : def;
    return {
      def: useDef,
      value: universalFilters[def.key] ?? useDef.defaultValue,
      onChange: (v: FilterValue) => setUniversalFilter(def.key, v),
    };
  });
  const addedItems = addedDefs.map((def) => ({
    def,
    value: universalFilters[def.key] ?? def.defaultValue,
    onChange: (v: FilterValue) => setUniversalFilter(def.key, v),
  }));
  const activeFilterCount =
    [...coreFilters, ...addedDefs].filter((d) =>
      d.isActive(universalFilters[d.key] ?? d.defaultValue)
    ).length + (investorActive ? 1 : 0);
  const soldWindowVisible =
    activeLayers.has("sold") || activeLayers.has("leased") || activeLayers.has("delisted");

  // Badge for the desktop "Filters" drawer button — only the filters that LIVE in
  // the drawer (deep property fields + investor signals), so it doesn't double-count
  // the basics that stay inline on the bar.
  const drawerActiveCount =
    moreFilters.filter((d) => d.isActive(universalFilters[d.key] ?? d.defaultValue)).length +
    (investorLayer ? INVESTOR_CONTROLS.filter((c) => isControlActive(c, filters)).length : 0);

  // Flatten the active filters (core + added + investor) into one removable token
  // list for the summary strip. Gates mirror the chip rows: added + investor are
  // active-browse only (!compOnly); investor is also residential-sale (investorLayer).
  const tokens = buildFilterTokens({
    coreItems,
    addedItems,
    // The strip surfaces EVERY active investor signal (full catalog), not just the
    // active persona's — so a value set under another persona is visible + removable,
    // never silently applied.
    controls: INVESTOR_CONTROLS,
    filters,
    setFilter,
    removeAddedFilter,
    showAdvanced: !compOnly,
    showInvestor: investorLayer,
    lenses,
  });

  return (
    <>
      {/* MOBILE (<md): layers stay inline (tab-like); all other filters move into
          the sheet behind a prominent, count-badged Filters button. */}
      <div className="flex items-center gap-2 border-t border-border bg-background px-3 py-2 md:hidden">
        <div className="no-scrollbar flex flex-1 items-center gap-2 overflow-x-auto">
          <LayerChips />
          {soldWindowVisible && <SoldWindowDropdown />}
        </div>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="relative flex min-h-[40px] shrink-0 items-center gap-1.5 border border-border bg-card px-3 text-[11px] font-semibold uppercase tracking-wider text-foreground transition-colors active:bg-muted"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-400" />
          Filters
          {activeFilterCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-bold leading-none text-slate-950">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* DESKTOP (md+): pinned mode anchors · scrolling filter chips · pinned nudge.
          Layers + class no longer scroll off the right edge, and every applied filter
          is summarised (and cleared) in the ActiveFilterStrip below. */}
      <div className="hidden h-11 items-center border-t border-border bg-background md:flex">
        {/* Pinned-left: listing-status layers + sold window + property class. */}
        <div className="flex shrink-0 items-center gap-x-2 pl-3 pr-1">
          <LayerChips />
          {soldWindowVisible && <SoldWindowDropdown />}
          <FundamentalToggle
            ariaLabel="Property class"
            value={propertyClass}
            onChange={setPropertyClass}
            options={[
              { value: "residential", label: "Residential" },
              { value: "commercial", label: "Commercial" },
            ]}
          />
        </div>
        <div className="h-5 w-px shrink-0 bg-muted" />

        {/* Scrolling-middle: just the basics (price · beds · baths · type). The deep
            field library + investor signals now live in the Filters drawer, so this
            row no longer overflows. The persona preset is centered in TopCommandBar. */}
        <div className="no-scrollbar flex flex-1 items-center gap-x-2 overflow-x-auto px-2">
          {coreFilters.map((def) => {
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
        </div>

        {/* Pinned-right: the Filters drawer button (deep + investor; active-browse only)
            and the live result nudge. Clear lives in the strip below now. */}
        <div className="flex shrink-0 items-center gap-3 pl-2 pr-3">
          {!compOnly && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={cn(
                LABEL,
                "relative flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-foreground transition-colors hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-300"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-400" />
              Filters
              {drawerActiveCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-bold leading-none text-slate-950">
                  {drawerActiveCount}
                </span>
              )}
            </button>
          )}
          <span className={cn(LABEL, nudge.overflowing ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
            {nudge.text}
          </span>
        </div>
      </div>

      {/* Consolidated active-query summary — the one place that shows every applied
          filter at once (incl. ones scrolled off the bar or hidden on mobile), each
          removable, with a single Clear all. Renders nothing when no filter is set. */}
      <ActiveFilterStrip tokens={tokens} onClearAll={clearAll} />

      {sheetOpen && (
        <MobileFilterSheet
          onClose={() => setSheetOpen(false)}
          coreItems={coreItems}
          controls={controls}
          moreControls={moreControls}
          showInvestor={investorLayer}
          showAdvanced={!compOnly}
          clearAll={clearAll}
          anyActive={anyActive}
          resultCount={totalCount}
        />
      )}

      {drawerOpen && (
        <FilterDrawer
          onClose={() => setDrawerOpen(false)}
          controls={controls}
          moreControls={moreControls}
          showInvestor={investorLayer}
          clearAll={clearAll}
          anyActive={anyActive}
          resultCount={totalCount}
        />
      )}
    </>
  );
}
