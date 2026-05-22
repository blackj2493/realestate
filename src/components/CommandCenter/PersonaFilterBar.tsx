/**
 * PersonaFilterBar — renders the active persona's filter controls from
 * PERSONA_CONFIG and binds them to the command-center store.
 */

"use client";

import React from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_CONFIG } from "@/lib/personas/personaConfig";

export default function PersonaFilterBar() {
  const { activePersona, filters, setFilter } = useCommandCenterStore();
  const controls = PERSONA_CONFIG[activePersona].controls;

  return (
    <div className="no-scrollbar flex items-center gap-5 overflow-x-auto border-t border-slate-800/50 bg-slate-900/30 px-4 py-2.5">
      {controls.map((c, i) => {
        if (c.kind === "slider") {
          return (
            <div key={i} className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">{c.label}:</span>
              <div className="w-28">
                <Slider
                  value={[filters[c.key]]}
                  onValueChange={([v]) => setFilter(c.key, v)}
                  min={c.min}
                  max={c.max}
                  step={c.step}
                />
              </div>
              <span className={cn("w-12 text-right font-mono text-xs", c.accent)}>{c.format(filters[c.key])}</span>
            </div>
          );
        }
        if (c.kind === "range") {
          return (
            <div key={i} className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">{c.label}:</span>
              <div className="w-28">
                <Slider
                  value={[filters[c.minKey], filters[c.maxKey]]}
                  onValueChange={([min, max]) => {
                    setFilter(c.minKey, min);
                    setFilter(c.maxKey, max);
                  }}
                  min={c.min}
                  max={c.max}
                  step={c.step}
                />
              </div>
              <span className={cn("w-16 text-right font-mono text-xs", c.accent)}>
                {c.format(filters[c.minKey])}-{c.format(filters[c.maxKey])}
              </span>
            </div>
          );
        }
        // toggle
        return (
          <button
            key={i}
            onClick={() => setFilter(c.key, !filters[c.key])}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-all",
              filters[c.key]
                ? "border-emerald-600/50 bg-emerald-900/30 text-emerald-300"
                : "border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200"
            )}
          >
            {c.label}
            <div className={cn("h-1.5 w-1.5 rounded-full", filters[c.key] ? "bg-emerald-400" : "bg-slate-600")} />
          </button>
        );
      })}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
        <span className="text-[10px] uppercase tracking-wider text-slate-500">Live</span>
      </div>
    </div>
  );
}
