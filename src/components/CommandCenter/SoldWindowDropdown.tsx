"use client";

import React from "react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { SOLD_WINDOW_OPTIONS, DELISTED_DISPLAY_MAX_DAYS } from "@/lib/sold/config";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";
const fmt = (d: number) => (d === 1 ? "Last 1 day" : `Last ${d} days`);

/** Time-window picker shown in Sold / Leased / De-listed mode. */
export default function SoldWindowDropdown() {
  const { soldWindowDays, setSoldWindowDays } = useCommandCenterStore();
  const activeLayers = useCommandCenterStore((s) => s.activeLayers);
  // De-listed comps live in a 90-day index window — hide the longer options
  // while that layer is lit (fetch clamps per kind regardless; see config.ts).
  const cap = activeLayers.has("delisted") ? DELISTED_DISPLAY_MAX_DAYS : Infinity;
  const options = SOLD_WINDOW_OPTIONS.filter((d) => d <= cap);
  const value = Math.min(soldWindowDays, options[options.length - 1]);
  return (
    <label className={`flex shrink-0 items-center gap-1.5 ${LABEL} text-muted-foreground`}>
      <span className="sr-only">Comp window</span>
      <select
        value={value}
        onChange={(e) => setSoldWindowDays(Number(e.target.value))}
        className="border border-border bg-card px-2 py-1.5 text-cyan-700 dark:text-cyan-300 focus:border-cyan-500/50 focus:outline-none"
      >
        {options.map((d) => (
          <option key={d} value={d}>{fmt(d)}</option>
        ))}
      </select>
    </label>
  );
}
