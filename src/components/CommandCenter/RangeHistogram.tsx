"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface RangeHistogramProps {
  counts: number[];
  maxCount: number;
  /** Slider bounds — must match the bands the counts were computed over. */
  min: number;
  max: number;
  /** Current selection; bars overlapping [lo, hi] render highlighted. */
  lo: number;
  hi: number;
  loading?: boolean;
}

/**
 * Thin distribution sparkline drawn behind a range slider: one bar per band,
 * height ∝ count, bars inside the current selection highlighted. Shows the user
 * where inventory actually sits across the dimension they're filtering. Counts
 * are full-population (multi_search), so this is a real signal, not a sample.
 */
export default function RangeHistogram({
  counts,
  maxCount,
  min,
  max,
  lo,
  hi,
  loading,
}: RangeHistogramProps) {
  const n = counts.length;

  if (loading && n === 0) {
    return <div className="h-10 w-full animate-pulse bg-slate-800/60" aria-hidden />;
  }
  if (n === 0 || max <= min) return null;

  const width = (max - min) / n;

  return (
    <div className="flex h-10 items-end gap-px" aria-hidden>
      {counts.map((c, i) => {
        const bandLo = min + i * width;
        const bandHi = min + (i + 1) * width;
        // Overlap test (last band is open-ended on the data side but its visual
        // cell still ends at `max`, which is fine for the highlight).
        const inSelection = bandHi > lo && bandLo < hi;
        const heightPct = maxCount > 0 ? Math.max(3, Math.round((c / maxCount) * 100)) : 3;
        return (
          <div
            key={i}
            title={c.toLocaleString("en-US")}
            style={{ height: `${heightPct}%` }}
            className={cn(
              "flex-1 transition-colors",
              inSelection ? "bg-cyan-500/70" : "bg-slate-700/50"
            )}
          />
        );
      })}
    </div>
  );
}
