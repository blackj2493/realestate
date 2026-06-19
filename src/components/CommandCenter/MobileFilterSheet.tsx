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
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { FilterControl } from "./FilterChip";
import InvestorChip from "./InvestorChip";
import FundamentalToggle from "./FundamentalToggle";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-slate-500";

export interface FilterItem {
  def: FilterDef;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}

interface MobileFilterSheetProps {
  onClose: () => void;
  /** Scoped core filters (class-aware price + type), ready to render expanded. */
  coreItems: FilterItem[];
  /** User-added deeper filters (active-browse only). */
  addedItems: FilterItem[];
  /** Persona investor controls (cap-rate / yield thresholds, etc.). */
  controls: React.ComponentProps<typeof InvestorChip>["control"][];
  /** Show the persona investor chips (residential-sale, active layer). */
  showInvestor: boolean;
  /** Show advanced (investor + added) sections (false in comp-only Sold/De-listed). */
  showAdvanced: boolean;
  clearAll: () => void;
  anyActive: boolean;
  /** Total matching listings — surfaced on the apply button. */
  resultCount: number;
}

export default function MobileFilterSheet({
  onClose,
  coreItems,
  addedItems,
  controls,
  showInvestor,
  showAdvanced,
  clearAll,
  anyActive,
  resultCount,
}: MobileFilterSheetProps) {
  const propertyClass = useCommandCenterStore((s) => s.propertyClass);
  const setPropertyClass = useCommandCenterStore((s) => s.setPropertyClass);

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
      <button type="button" aria-label="Close filters" onClick={onClose} className="absolute inset-0 bg-slate-950/80" />

      <div className="relative flex max-h-[88dvh] flex-col border-t border-slate-700 bg-slate-950 pb-safe">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3 pt-safe">
          <h2 className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wider text-slate-100">
            <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="-mr-2 flex h-11 w-11 items-center justify-center text-slate-400 hover:text-slate-200"
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
            <section key={def.key} className="border-t border-slate-800/70 pt-4">
              <FilterControl def={def} value={value} onChange={onChange} />
            </section>
          ))}

          {showAdvanced &&
            addedItems.map(({ def, value, onChange }) => (
              <section key={def.key} className="border-t border-slate-800/70 pt-4">
                <FilterControl def={def} value={value} onChange={onChange} />
              </section>
            ))}

          {showAdvanced && showInvestor && controls.length > 0 && (
            <section className="space-y-2 border-t border-slate-800/70 pt-4">
              <span className={LABEL}>Persona signals</span>
              <div className="flex flex-wrap gap-2">
                {controls.map((c, i) => (
                  <InvestorChip key={i} control={c} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer — Clear + apply (count). Both are real 44px targets. */}
        <div className="flex shrink-0 items-center gap-3 border-t border-slate-800 px-4 py-3">
          {anyActive && (
            <button
              type="button"
              onClick={clearAll}
              className={cn(
                "min-h-[44px] flex-1 border border-slate-700 px-4 font-mono text-xs font-semibold uppercase tracking-wider text-slate-300",
                "transition-colors hover:border-cyan-500/50 hover:text-cyan-300 active:bg-slate-800"
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
