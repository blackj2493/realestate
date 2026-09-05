"use client";

import { MapPin, Plus, X } from "lucide-react";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";

/**
 * The collapsed state of MarketPicker — the control that decides what the whole dashboard
 * shows.
 *
 * It replaces the old "Add areas" ghost button, which named only half of what the picker
 * does (the picker adds AND removes) and read as chrome rather than as the thing every
 * panel below depends on. So this states the set, not the verb: the count, the live chips,
 * and one line saying the dashboard is built from them.
 *
 * Chips remove in one tap — the common edit — so only adding needs the full picker.
 * Removal routes through the dashboard's removeRegion, so it also retires the area's
 * nightly alert row; see MarketPicker for why that must never be bypassed.
 *
 * Mobile: the chip row scrolls sideways rather than wrapping into a ragged block (same
 * pattern as MarketActivityControls), and every target clears 44px. Add stays OUT of that
 * scroller — inside it, the one action that grows the dashboard scrolled off-screen.
 */
export default function TrackedMarketsBar({
  regions,
  onRemove,
  onEdit,
}: {
  regions: string[];
  /** Drop one area. The dashboard reopens the picker if this empties the set. */
  onRemove: (area: string) => void;
  /** Reopen the picker to add an area. */
  onEdit: () => void;
}) {
  return (
    <section
      aria-label="Your markets"
      className="border border-border border-l-2 border-l-cyan-500 bg-card/40 p-3 dark:border-l-cyan-400/70 dark:bg-slate-900/40"
    >
      <div className="flex items-center gap-1.5">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-400" />
        <h2 className="terminal-font text-[10px] font-semibold uppercase tracking-wider text-foreground">
          Your markets
        </h2>
        <span className="terminal-font text-[10px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
          · {regions.length}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="terminal-font ml-2 inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap border border-cyan-600 bg-cyan-600 px-3 text-[11px] uppercase tracking-wider text-white transition-colors hover:bg-cyan-700 sm:min-h-[32px] dark:border-cyan-500/50 dark:bg-cyan-500/15 dark:text-cyan-200 dark:hover:bg-cyan-500/25"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        {regions.map((area) => (
          <span
            key={area}
            title={area}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap border border-cyan-600/50 bg-cyan-600/10 pl-3 pr-1 text-xs font-medium text-cyan-700 sm:min-h-[32px] dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-100"
          >
            {formatRegionLabel(area)}
            <button
              type="button"
              onClick={() => onRemove(area)}
              aria-label={`Stop tracking ${formatRegionLabel(area)}`}
              className="inline-flex h-8 w-8 items-center justify-center text-cyan-700/70 transition-colors hover:bg-cyan-600/15 hover:text-cyan-900 sm:h-6 sm:w-6 dark:text-cyan-300/70 dark:hover:bg-cyan-500/25 dark:hover:text-cyan-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Every panel below is built from these.
      </p>
    </section>
  );
}
