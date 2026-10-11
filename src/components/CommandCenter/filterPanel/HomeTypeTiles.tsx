"use client";

/**
 * Home type as a row of picture tiles. People recognise a detached house faster than they
 * read "Att/Row/Townhouse", so each type gets a small line drawing; the label underneath
 * stays the plain name. The row scrolls sideways and the last tile is cut at the edge,
 * which is the hint that there is more.
 *
 * Counts come from the live search's facet while the filter is unset (useOptionCounts).
 */

import React from "react";
import { Briefcase, Building2, Factory, Store, Tractor, Trees, Warehouse, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import { useOptionCounts } from "../FilterChip";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Line drawings for the residential types, keyed by the live PropertySubType value. */
const DRAWINGS: Record<string, React.ReactNode> = {
  Detached: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  "Semi-Detached ": (
    <>
      <path d="M1.5 12 7 7.5l5 4 5-4 5.5 4.5" />
      <path d="M3 11v9h18v-9" />
      <path d="M12 11.5V20" />
      <path d="M6 20v-4h2.5v4M15.5 20v-4H18v4" />
    </>
  ),
  "Att/Row/Townhouse": (
    <>
      <path d="M2 10.5 5.5 7 9 10.5 12.5 7 16 10.5 19.5 7 22 9.5" />
      <path d="M3 9.5V20h18V9.5" />
      <path d="M9 10.5V20M16 10.5V20" />
    </>
  ),
  "Condo Townhouse": (
    <>
      <path d="M2 10.5 5.5 7 9 10.5 12.5 7 16 10.5 19.5 7 22 9.5" />
      <path d="M3 9.5V20h18V9.5" />
      <path d="M3 14.5h18" />
    </>
  ),
  "Condo Apartment": (
    <>
      <rect x="6" y="3" width="12" height="18" rx="1" />
      <path d="M9.5 7h1M13.5 7h1M9.5 10.5h1M13.5 10.5h1M9.5 14h1M13.5 14h1M11 21v-3h2v3" />
    </>
  ),
  Link: (
    <>
      <path d="M2 12 6.5 8l4.5 4" />
      <path d="M13 12l4.5-4 4.5 4" />
      <path d="M3.5 11v9H20.5v-9" />
      <path d="M11 13h2" />
    </>
  ),
  Duplex: (
    <>
      <path d="M4 9.5 12 4l8 5.5" />
      <path d="M5.5 8.5V20h13V8.5" />
      <path d="M5.5 14h13" />
      <path d="M8.5 11h2M13.5 11h2M11 20v-3h2v3" />
    </>
  ),
  Multiplex: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="1" />
      <path d="M4 10.5h16M4 15.5h16M12 5v16" />
    </>
  ),
  "Vacant Land": (
    <>
      <path d="M2 20h20" />
      <path d="M7 20v-5" />
      <circle cx="7" cy="11" r="4" />
      <path d="M14 20l3-8 3 8" />
    </>
  ),
};

/** Commercial types use stock icons; anything unknown falls back to a building. */
const COMMERCIAL_ICONS: Record<string, LucideIcon> = {
  "Commercial Retail": Store,
  Office: Building2,
  Industrial: Factory,
  "Sale Of Business": Briefcase,
  Investment: Building2,
  Land: Trees,
  Farm: Tractor,
  "Store W Apt/Office": Warehouse,
};

function TypeIcon({ value }: { value: string }) {
  const drawing = DRAWINGS[value];
  if (drawing)
    return (
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden {...stroke}>
        {drawing}
      </svg>
    );
  const Icon = COMMERCIAL_ICONS[value] ?? Building2;
  return <Icon className="h-[22px] w-[22px]" strokeWidth={1.7} aria-hidden />;
}

/** "Condo Apartment" → "Condo apt": tiles are 78px wide. */
const SHORT: Record<string, string> = {
  "Semi-Detached ": "Semi",
  "Att/Row/Townhouse": "Town",
  "Condo Townhouse": "Condo town",
  "Condo Apartment": "Condo apt",
  "Vacant Land": "Land",
  "Commercial Retail": "Retail",
  "Sale Of Business": "Business",
  "Store W Apt/Office": "Store + apt",
};

export default function HomeTypeTiles({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  const selected = (value as string[]) ?? [];
  const counts = useOptionCounts(def, value);
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div
      role="group"
      aria-label={def.label}
      className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
    >
      {(def.options ?? []).map((opt) => {
        const on = selected.includes(opt.value);
        const n = counts?.[opt.value];
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            aria-label={opt.label}
            onClick={() => toggle(opt.value)}
            className={cn(
              "flex h-[80px] w-[78px] shrink-0 flex-col items-center justify-center gap-1 border px-1 transition-colors",
              on
                ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                : "border-border bg-card text-muted-foreground hover:border-cyan-500/50 hover:text-foreground"
            )}
          >
            <TypeIcon value={opt.value} />
            <span
              className={cn(
                "text-center text-[10px] font-semibold uppercase leading-tight tracking-wider",
                on ? "" : "text-foreground"
              )}
            >
              {SHORT[opt.value] ?? opt.label}
            </span>
            {n !== undefined && (
              <span className="font-mono text-[10px] leading-none text-muted-foreground">{n.toLocaleString("en-US")}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
