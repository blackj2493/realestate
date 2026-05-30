"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Popover } from "@/components/ui/popover";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { defaultTerminalFilters, type ControlDef } from "@/lib/personas/personaConfig";
import { isControlActive, investorChipLabel } from "./investorControls";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const chipClass = (active: boolean) =>
  cn(
    "flex shrink-0 cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 transition-all",
    LABEL,
    active
      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
      : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200"
  );

export default function InvestorChip({ control }: { control: ControlDef }) {
  const { filters, setFilter } = useCommandCenterStore();
  const active = isControlActive(control, filters);
  const text = investorChipLabel(control, filters);

  if (control.kind === "toggle") {
    return (
      <button className={chipClass(active)} onClick={() => setFilter(control.key, !filters[control.key])}>
        <span className={cn("h-1.5 w-1.5", active ? "bg-cyan-400" : "bg-slate-600")} />
        {text}
      </button>
    );
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (control.kind === "slider") {
      setFilter(control.key, defaultTerminalFilters[control.key]);
    } else {
      setFilter(control.minKey, defaultTerminalFilters[control.minKey]);
      setFilter(control.maxKey, defaultTerminalFilters[control.maxKey]);
    }
  };

  const valueText =
    control.kind === "slider"
      ? control.format(filters[control.key])
      : `${control.format(filters[control.minKey])}–${control.format(filters[control.maxKey])}`;

  const trigger = (
    <span className={chipClass(active)}>
      {text}
      {active && <X className="h-3 w-3 opacity-70 hover:opacity-100" onClick={clear} />}
    </span>
  );

  return (
    <Popover trigger={trigger} className="w-56">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className={cn(LABEL, "text-slate-400")}>{control.label}</span>
          <span className="font-mono text-xs text-cyan-400">{valueText}</span>
        </div>
        {control.kind === "slider" ? (
          <Slider
            value={[filters[control.key]]}
            min={control.min}
            max={control.max}
            step={control.step}
            onValueChange={([v]) => setFilter(control.key, v)}
          />
        ) : (
          <Slider
            value={[filters[control.minKey], filters[control.maxKey]]}
            min={control.min}
            max={control.max}
            step={control.step}
            onValueChange={([lo, hi]) => {
              setFilter(control.minKey, lo);
              setFilter(control.maxKey, hi);
            }}
          />
        )}
      </div>
    </Popover>
  );
}
