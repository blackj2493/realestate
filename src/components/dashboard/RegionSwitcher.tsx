"use client";

/**
 * RegionSwitcher — a compact segmented toggle for flipping the single-city
 * intelligence tiles (Neighbourhood Heat, Market Pulse) between the user's
 * configured regions. Renders nothing for a single region (nothing to switch).
 *
 * Active-state styling mirrors the metric toggles on the same tiles: solid teal
 * (dt-sig) in light, the translucent cyan chip in dark — so the switcher reads as
 * part of the same instrument, not a bolt-on.
 */

import { cn } from "@/lib/utils";

export default function RegionSwitcher({
  regions,
  selected,
  onSelect,
  className,
}: {
  regions: string[];
  selected: string;
  onSelect: (region: string) => void;
  className?: string;
}) {
  if (regions.length <= 1) return null;

  return (
    <div
      role="group"
      aria-label="Switch city"
      className={cn("flex flex-wrap border border-border", className)}
    >
      {regions.map((r) => {
        const on = r === selected;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onSelect(r)}
            aria-pressed={on}
            className={cn(
              "terminal-font border-r border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors last:border-r-0",
              on
                ? "bg-[color:var(--dt-sig)] text-white dark:bg-cyan-500/20 dark:text-cyan-300"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}
