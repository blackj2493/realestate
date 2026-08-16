/**
 * MobileFilterSheet — the phone (<md) filter surface. On a 360px canvas the
 * inline FilterBar chips scroll off-screen and are undiscoverable, so on mobile
 * the bar collapses to a "Filters" button that opens THIS bottom sheet, where
 * every control renders expanded at full tap-size (HouseSigma-style).
 *
 * It reuses the exact same control + chip components as the desktop bar
 * (FilterControl, InvestorChip, FundamentalToggle) so the query pipeline and
 * formatting can never drift between the two surfaces.
 */

"use client";

import React from "react";
import { X, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import { moreFiltersForClass, cloneFilterValue } from "@/lib/filters/filterRegistry";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useDiscovery } from "@/lib/discovery/useDiscovery";
import FilterChip, { FilterControl } from "./FilterChip";
import InvestorChip from "./InvestorChip";
import FundamentalToggle from "./FundamentalToggle";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

const freshDefault = cloneFilterValue;

export interface FilterItem {
  def: FilterDef;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}

interface MobileFilterSheetProps {
  onClose: () => void;
  /** Scoped core filters (class-aware price + type), ready to render expanded. */
  coreItems: FilterItem[];
  /** The active persona's PINNED investor controls (shown first). */
  controls: React.ComponentProps<typeof InvestorChip>["control"][];
  /** Every OTHER investor signal — addable regardless of persona. */
  moreControls: React.ComponentProps<typeof InvestorChip>["control"][];
  /** Show the investor chips (residential-sale, active layer). */
  showInvestor: boolean;
  /** Show advanced (deep field library + investor) sections (false in comp-only Sold/De-listed). */
  showAdvanced: boolean;
  clearAll: () => void;
  anyActive: boolean;
  /** Total matching listings — surfaced on the apply button. */
  resultCount: number;
}

export default function MobileFilterSheet({
  onClose,
  coreItems,
  controls,
  moreControls,
  showInvestor,
  showAdvanced,
  clearAll,
  anyActive,
  resultCount,
}: MobileFilterSheetProps) {
  const propertyClass = useCommandCenterStore((s) => s.propertyClass);
  const setPropertyClass = useCommandCenterStore((s) => s.setPropertyClass);
  // Deep field library — read the same store slices the desktop FilterDrawer does
  // so the two surfaces share one source of truth (and the active-filter strip
  // stays in sync via addFilter/removeAddedFilter).
  const universalFilters = useCommandCenterStore((s) => s.universalFilters);
  const setUniversalFilter = useCommandCenterStore((s) => s.setUniversalFilter);
  const addFilter = useCommandCenterStore((s) => s.addFilter);
  const removeAddedFilter = useCommandCenterStore((s) => s.removeAddedFilter);

  // While this sheet is open, hide the global Guide launcher (FAB) so it can't
  // float over the "Show N results" CTA below. Mounts only when open, so a plain
  // mount/unmount ref-count is enough. See useDiscovery.chromeBlockers.
  React.useEffect(() => {
    const { blockChrome, unblockChrome } = useDiscovery.getState();
    blockChrome();
    return unblockChrome;
  }, []);

  // Lock body scroll while open; close on Escape.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Filters"
    >
      {/* Backdrop — tap to dismiss. */}
      <button type="button" aria-label="Close filters" onClick={onClose} className="absolute inset-0 bg-background/80" />

      <div className="relative flex max-h-[88dvh] flex-col border-t border-border bg-background pb-safe">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 pt-safe">
          <h2 className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            <SlidersHorizontal className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="-mr-2 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — scrollable list of expanded controls. */}
        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
          <section className="space-y-2">
            <span className={LABEL}>Property class</span>
            <FundamentalToggle
              ariaLabel="Property class"
              value={propertyClass}
              onChange={setPropertyClass}
              options={[
                { value: "residential", label: "Residential" },
                { value: "commercial", label: "Commercial" },
              ]}
            />
          </section>

          {coreItems.map(({ def, value, onChange }) => (
            <section key={def.key} className="border-t border-border/70 pt-4">
              <FilterControl def={def} value={value} onChange={onChange} />
            </section>
          ))}

          {/* More filters — the full deep field library, identical to the desktop
              "Filters" drawer. On mobile there's no separate drawer, so these live
              here as tap-to-open chips (their popovers portal above the sheet). */}
          {showAdvanced && (
            <section className="space-y-2 border-t border-border/70 pt-4">
              <span className={LABEL}>More filters</span>
              <div className="flex flex-wrap gap-2">
                {moreFiltersForClass(propertyClass).map((def) => (
                  <FilterChip
                    key={def.key}
                    def={def}
                    value={universalFilters[def.key] ?? def.defaultValue}
                    onChange={(v) => {
                      setUniversalFilter(def.key, v);
                      // Track the key so the active-filter strip sees it (mirrors drawer).
                      if (def.isActive(v)) addFilter(def.key);
                      else removeAddedFilter(def.key);
                    }}
                    onClear={() => {
                      setUniversalFilter(def.key, freshDefault(def.defaultValue));
                      removeAddedFilter(def.key);
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          {showAdvanced && showInvestor && controls.length > 0 && (
            <section className="space-y-2 border-t border-border/70 pt-4">
              <span className={LABEL}>Persona signals</span>
              <div className="flex flex-wrap gap-2">
                {controls.map((c, i) => (
                  <InvestorChip key={i} control={c} />
                ))}
              </div>
            </section>
          )}

          {showAdvanced && showInvestor && moreControls.length > 0 && (
            <section className="space-y-2 border-t border-border/70 pt-4">
              <span className={LABEL}>More investor signals</span>
              <div className="flex flex-wrap gap-2">
                {moreControls.map((c, i) => (
                  <InvestorChip key={i} control={c} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer — Clear + apply (count). Both are real 44px targets. */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-3">
          {anyActive && (
            <button
              type="button"
              onClick={clearAll}
              className={cn(
                "min-h-[44px] flex-1 border border-border px-4 font-mono text-xs font-semibold uppercase tracking-wider text-foreground",
                "transition-colors hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-300 active:bg-muted"
              )}
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-[2] bg-cyan-500 px-4 font-mono text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 active:bg-cyan-600"
          >
            Show {resultCount.toLocaleString()} {resultCount === 1 ? "result" : "results"}
          </button>
        </div>
      </div>
    </div>
  );
}
