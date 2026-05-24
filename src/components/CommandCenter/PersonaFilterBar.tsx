/**
 * PersonaFilterBar — the parameter ribbon. Renders the active persona's filter
 * controls from PERSONA_CONFIG and binds them to the command-center store.
 */

"use client";

import React from "react";
import { RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import {
  PERSONA_CONFIG,
  defaultTerminalFilters,
  type ControlDef,
  type TerminalFilterState,
} from "@/lib/personas/personaConfig";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

/** Whether a control currently differs from its default value. */
function isControlActive(c: ControlDef, f: TerminalFilterState): boolean {
  if (c.kind === "slider") return f[c.key] !== defaultTerminalFilters[c.key];
  if (c.kind === "range")
    return (
      f[c.minKey] !== defaultTerminalFilters[c.minKey] ||
      f[c.maxKey] !== defaultTerminalFilters[c.maxKey]
    );
  return f[c.key] !== defaultTerminalFilters[c.key];
}

export default function PersonaFilterBar() {
  const { activePersona, filters, setFilter, resetFilters } = useCommandCenterStore();
  const controls = PERSONA_CONFIG[activePersona].controls;

  const firstToggleIndex = controls.findIndex((c) => c.kind === "toggle");
  const activeCount = controls.filter((c) => isControlActive(c, filters)).length;

  return (
    <div className="no-scrollbar flex h-11 items-center gap-x-5 overflow-x-auto border-t border-slate-800 bg-slate-900 px-3">
      {controls.map((c, i) => {
        const active = isControlActive(c, filters);
        const divider =
          i === firstToggleIndex && firstToggleIndex > 0 ? (
            <div key={`div-${i}`} className="h-6 w-px shrink-0 bg-slate-800" />
          ) : null;

        if (c.kind === "slider") {
          return (
            <React.Fragment key={i}>
              {divider}
              <div className="flex shrink-0 items-center gap-2">
                <span className={cn(LABEL, "whitespace-nowrap", active ? "text-cyan-300" : "text-slate-400")}>
                  {c.label}
                </span>
                <div className="w-24">
                  <Slider
                    value={[filters[c.key]]}
                    onValueChange={([v]) => setFilter(c.key, v)}
                    min={c.min}
                    max={c.max}
                    step={c.step}
                  />
                </div>
                <span className="w-12 text-right font-mono text-xs text-cyan-400">{c.format(filters[c.key])}</span>
              </div>
            </React.Fragment>
          );
        }
        if (c.kind === "range") {
          return (
            <React.Fragment key={i}>
              {divider}
              <div className="flex shrink-0 items-center gap-2">
                <span className={cn(LABEL, "whitespace-nowrap", active ? "text-cyan-300" : "text-slate-400")}>
                  {c.label}
                </span>
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
                <span className="w-16 text-right font-mono text-xs text-cyan-400">
                  {c.format(filters[c.minKey])}-{c.format(filters[c.maxKey])}
                </span>
              </div>
            </React.Fragment>
          );
        }
        // toggle
        return (
          <React.Fragment key={i}>
            {divider}
            <button
              onClick={() => setFilter(c.key, !filters[c.key])}
              className={cn(
                "flex shrink-0 items-center gap-2 border px-2.5 py-1.5 transition-all",
                LABEL,
                active
                  ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                  : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              )}
            >
              <span className={cn("h-1.5 w-1.5", active ? "bg-cyan-400" : "bg-slate-600")} />
              {c.label}
            </button>
          </React.Fragment>
        );
      })}

      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
        {activeCount > 0 && (
          <button
            onClick={resetFilters}
            className={cn(
              LABEL,
              "flex items-center gap-1.5 border border-cyan-500/40 bg-cyan-500/10 py-1 pl-2.5 pr-2 text-cyan-300 transition-colors hover:border-cyan-400/60 hover:bg-cyan-500/20"
            )}
          >
            {activeCount} active
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
          <span className={cn(LABEL, "text-slate-400")}>Live</span>
        </div>
      </div>
    </div>
  );
}
