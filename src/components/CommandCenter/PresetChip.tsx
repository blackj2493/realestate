"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_CONFIG } from "@/lib/personas/personaConfig";
import PersonaMenuList from "@/components/personas/PersonaMenuList";

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
      {/* Mobile: icon + chevron only so the chip can't overflow onto the search
          icon in the crowded top row (the dropdown still lists all four full
          persona names). sm+: show the full label. */}
      <span className="hidden sm:inline">{active.label}</span>
      <ChevronDown className="h-3 w-3 opacity-70" />
    </span>
  );

  return (
    <Popover trigger={trigger} className="w-56 p-1">
      {(close) => (
        <PersonaMenuList
          value={activePersona}
          onSelect={(p) => {
            setActivePersona(p);
            close();
          }}
        />
      )}
    </Popover>
  );
}
