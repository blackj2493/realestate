"use client";

import React from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_LIST, PERSONA_CONFIG } from "@/lib/personas/personaConfig";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

/**
 * Gold preset chip — the persona reframed as a factory preset. The dropdown
 * lists the four personas; selecting one swaps the bar's investor chips, sort,
 * map color and default map mode (all driven downstream by activePersona).
 */
export default function PresetChip() {
  const { activePersona, setActivePersona } = useCommandCenterStore();
  const active = PERSONA_CONFIG[activePersona];
  const ActiveIcon = active.icon;

  const trigger = (
    <span
      className={cn(
        LABEL,
        "flex shrink-0 cursor-pointer items-center gap-1.5 border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5 text-amber-300 transition-colors hover:border-amber-300/70 hover:bg-amber-400/20"
      )}
    >
      <ActiveIcon className="h-3.5 w-3.5" />
      {active.label}
      <ChevronDown className="h-3 w-3 opacity-70" />
    </span>
  );

  return (
    <Popover trigger={trigger} className="w-56 p-1">
      {(close) => (
        <div className="flex flex-col">
          <span className={cn(LABEL, "px-2 py-1.5 text-slate-500")}>Preset</span>
          {PERSONA_LIST.map((p) => {
            const Icon = p.icon;
            const selected = p.id === activePersona;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setActivePersona(p.id);
                  close();
                }}
                className={cn(
                  "flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors",
                  selected
                    ? "text-amber-300"
                    : "text-slate-300 hover:bg-amber-400/10 hover:text-amber-200"
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {p.label}
                </span>
                {selected && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
