/**
 * FilterDrawer — the desktop (md+) home for the deep field library and the persona
 * investor signals. Phase 2 of the filter redesign: instead of those 15+ chips
 * overflowing the bar's right edge behind a hidden scrollbar, the bar carries only
 * the basics + a single count-badged "Filters" button that opens THIS right-side
 * drawer, where every advanced filter is grouped, searchable, and one click away.
 *
 * It reuses the exact same FilterChip / InvestorChip units as the bar (their
 * popovers portal to <body>, so they open above the drawer), so the control logic,
 * live counts, and query pipeline never diverge between the two surfaces.
 */

"use client";

import React from "react";
import { X, SlidersHorizontal, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { useDiscovery } from "@/lib/discovery/useDiscovery";
import { moreFiltersForClass } from "@/lib/filters/filterRegistry";
import type { ControlDef } from "@/lib/personas/personaConfig";
import type { FilterValue } from "@/lib/filters/types";
import FilterChip from "./FilterChip";
import InvestorChip from "./InvestorChip";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

const freshDefault = (v: FilterValue): FilterValue =>
  Array.isArray(v) ? ([...v] as FilterValue) : v;

/** Stable React key for a persona control (slider/toggle use `key`, range uses `minKey`). */
const controlKey = (c: ControlDef): string => (c.kind === "range" ? c.minKey : c.key);

interface FilterDrawerProps {
  onClose: () => void;
  /** The active persona's PINNED investor controls (shown first, prominent). */
  controls: ControlDef[];
  /** Every OTHER investor signal — addable here regardless of persona. */
  moreControls: ControlDef[];
  /** Show the investor sections (residential-sale, active layer). */
  showInvestor: boolean;
  clearAll: () => void;
  anyActive: boolean;
  /** Total matching listings — surfaced on the apply button. */
  resultCount: number;
}

export default function FilterDrawer({
  onClose,
  controls,
  moreControls,
  showInvestor,
  clearAll,
  anyActive,
  resultCount,
}: FilterDrawerProps) {
  const universalFilters = useCommandCenterStore((s) => s.universalFilters);
  const setUniversalFilter = useCommandCenterStore((s) => s.setUniversalFilter);
  const addFilter = useCommandCenterStore((s) => s.addFilter);
  const removeAddedFilter = useCommandCenterStore((s) => s.removeAddedFilter);
  const propertyClass = useCommandCenterStore((s) => s.propertyClass);
  const [q, setQ] = React.useState("");

  // While this drawer is open, hide the global Guide launcher (FAB) so it can't
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

  const needle = q.trim().toLowerCase();
  const matchesNeedle = (c: ControlDef) =>
    (c.short ?? c.label).toLowerCase().includes(needle) || c.label.toLowerCase().includes(needle);
  const propertyDefs = moreFiltersForClass(propertyClass).filter((d) => d.label.toLowerCase().includes(needle));
  const investorMatches = showInvestor ? controls.filter(matchesNeedle) : [];
  const moreInvestorMatches = showInvestor ? moreControls.filter(matchesNeedle) : [];
  const empty =
    propertyDefs.length === 0 && investorMatches.length === 0 && moreInvestorMatches.length === 0;

  return (
    <div className="fixed inset-0 z-[60] hidden md:block" role="dialog" aria-modal="true" aria-label="All filters">
      {/* Backdrop — click to dismiss. */}
      <button type="button" aria-label="Close filters" onClick={onClose} className="absolute inset-0 bg-background/70" />

      <div className="absolute right-0 top-0 flex h-full w-[360px] flex-col border-l border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            <SlidersHorizontal className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
            All Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="-mr-2 flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-4 pt-3">
          <div className="flex items-center gap-2 border border-border bg-card px-2.5 focus-within:border-cyan-500/50">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search filters…"
              autoFocus
              className="w-full bg-transparent py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </div>

        {/* Body — searchable, categorised chips. */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {propertyDefs.length > 0 && (
            <section className="space-y-2">
              <span className={LABEL}>Property</span>
              <div className="flex flex-wrap gap-2">
                {propertyDefs.map((def) => (
                  <FilterChip
                    key={def.key}
                    def={def}
                    value={universalFilters[def.key] ?? def.defaultValue}
                    onChange={(v) => {
                      setUniversalFilter(def.key, v);
                      // Track the key so the active-filter strip + mobile sheet see it.
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

          {investorMatches.length > 0 && (
            <section className="space-y-2 border-t border-border/70 pt-4">
              <span className={LABEL}>Investor · Persona signals</span>
              <div className="flex flex-wrap gap-2">
                {investorMatches.map((c) => (
                  <InvestorChip key={controlKey(c)} control={c} />
                ))}
              </div>
            </section>
          )}

          {moreInvestorMatches.length > 0 && (
            <section className="space-y-2 border-t border-border/70 pt-4">
              <span className={LABEL}>More investor signals</span>
              <div className="flex flex-wrap gap-2">
                {moreInvestorMatches.map((c) => (
                  <InvestorChip key={controlKey(c)} control={c} />
                ))}
              </div>
            </section>
          )}

          {empty && (
            <p className="px-1 py-8 text-center text-xs text-muted-foreground">No filters match “{q}”.</p>
          )}
        </div>

        {/* Footer — Clear + apply (count). */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-3">
          {anyActive && (
            <button
              type="button"
              onClick={clearAll}
              className={cn(
                "min-h-[40px] flex-1 border border-border px-4 font-mono text-xs font-semibold uppercase tracking-wider text-foreground",
                "transition-colors hover:border-rose-500/40 hover:text-rose-300"
              )}
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] flex-[2] bg-cyan-500 px-4 font-mono text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
          >
            Show {resultCount.toLocaleString()} {resultCount === 1 ? "result" : "results"}
          </button>
        </div>
      </div>
    </div>
  );
}
