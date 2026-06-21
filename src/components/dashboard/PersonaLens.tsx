"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import PersonaMenuList from "@/components/personas/PersonaMenuList";
import { PERSONA_CONFIG, type PersonaType } from "@/lib/personas/personaConfig";

/**
 * Elevated gold "lens" persona selector — Mission Control's centerpiece control.
 * Same dropdown pattern, gold palette and option list as the terminal's
 * PresetChip (via PersonaMenuList), but enlarged and captioned so it reads as
 * the hero of the dashboard rather than a utility chip. Prop-driven: the
 * dashboard owns persona state (config.persona), the terminal owns its own.
 */
export default function PersonaLens({
  persona,
  onChange,
}: {
  persona: PersonaType;
  onChange: (p: PersonaType) => void;
}) {
  const active = PERSONA_CONFIG[persona];
  const ActiveIcon = active.icon;

  // Trigger is a <span>, not a <button>: Popover supplies the click handler on
  // its own wrapper <div>, and nesting interactive elements breaks a11y /
  // hydration. Mirrors the terminal's PresetChip trigger exactly.
  const trigger = (
    <span
      data-tour="dashboard-persona"
      className={cn(
        "terminal-font group flex cursor-pointer items-center gap-2.5 border border-amber-400/60 bg-amber-400/10 px-4 py-2.5",
        "text-amber-300 shadow-[0_0_24px_-6px_rgba(251,191,36,0.55)] transition-colors",
        "hover:border-amber-300/80 hover:bg-amber-400/20"
      )}
    >
      <ActiveIcon className="h-4 w-4 shrink-0" />
      <span className="text-sm font-semibold uppercase tracking-[0.15em]">{active.label}</span>
      <ChevronDown className="h-4 w-4 shrink-0 opacity-70 transition-transform group-hover:translate-y-0.5" />
    </span>
  );

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="terminal-font text-[10px] uppercase tracking-[0.2em] text-slate-500">
        Viewing your dashboard as
      </span>
      <Popover trigger={trigger} className="w-60 p-1">
        {(close) => (
          <PersonaMenuList
            value={persona}
            heading="Switch persona"
            onSelect={(p) => {
              onChange(p);
              close();
            }}
          />
        )}
      </Popover>
    </div>
  );
}
