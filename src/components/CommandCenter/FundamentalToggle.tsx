"use client";

import React from "react";
import { cn } from "@/lib/utils";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

interface FundamentalToggleProps<T extends string> {
  options: ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the segmented group. */
  ariaLabel: string;
}

/**
 * Compact segmented control for the terminal's fundamental axes (For Sale/Rent,
 * Residential/Commercial). These sit at the far left of the FilterBar, before the
 * persona preset — they gate the whole query, so they read as a hard switch, not a
 * dismissible chip. Styling matches the bar (uppercase 10px, cyan active state).
 */
export default function FundamentalToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: FundamentalToggleProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex shrink-0 items-center divide-x divide-slate-800 border border-slate-800 bg-slate-900"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              LABEL,
              "px-2.5 py-1.5 transition-colors",
              active
                ? "bg-cyan-500/15 text-cyan-300"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
