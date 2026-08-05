"use client";
import React from "react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { LAYER_KEYS, type LayerKey } from "@/lib/sold/layers";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";
const META: Record<LayerKey, { label: string; on: string }> = {
  forSale:  { label: "For Sale",   on: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  sold:     { label: "Sold",       on: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  forRent:  { label: "For Rent",   on: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  leased:   { label: "Leased",     on: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  delisted: { label: "De-listed",  on: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

/** Independent multi-select status layers (any combination; never empty). */
export default function LayerChips() {
  const activeLayers = useCommandCenterStore((s) => s.activeLayers);
  const toggleLayer = useCommandCenterStore((s) => s.toggleLayer);
  return (
    <div role="group" aria-label="Listing layers" className="flex shrink-0 items-center divide-x divide-border border border-border bg-card">
      {LAYER_KEYS.map((key) => {
        const active = activeLayers.has(key);
        return (
          <button key={key} type="button" aria-pressed={active} onClick={() => toggleLayer(key)}
            className={cn(LABEL, "px-2.5 py-1.5 transition-colors", active ? META[key].on : "text-muted-foreground hover:text-foreground")}>
            {META[key].label}
          </button>
        );
      })}
    </div>
  );
}
