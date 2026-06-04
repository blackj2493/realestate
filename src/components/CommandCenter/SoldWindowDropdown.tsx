"use client";

import React from "react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { SOLD_WINDOW_OPTIONS } from "@/lib/sold/config";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";
const fmt = (d: number) => (d === 1 ? "Last 1 day" : `Last ${d} days`);

/** Time-window picker shown only in Sold mode (mirrors the HouseSigma "90d" control). */
export default function SoldWindowDropdown() {
  const { soldWindowDays, setSoldWindowDays } = useCommandCenterStore();
  return (
    <label className={`flex shrink-0 items-center gap-1.5 ${LABEL} text-slate-400`}>
      <span className="sr-only">Sold window</span>
      <select
        value={soldWindowDays}
        onChange={(e) => setSoldWindowDays(Number(e.target.value))}
        className="border border-slate-800 bg-slate-900 px-2 py-1.5 text-cyan-300 focus:border-cyan-500/50 focus:outline-none"
      >
        {SOLD_WINDOW_OPTIONS.map((d) => (
          <option key={d} value={d}>
            {fmt(d)}
          </option>
        ))}
      </select>
    </label>
  );
}
