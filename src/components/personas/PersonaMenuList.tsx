"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PERSONA_LIST, type PersonaType } from "@/lib/personas/personaConfig";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

/**
 * Shared persona dropdown body — the four-persona option list with the gold
 * active state and check mark. Rendered inside a Popover by PersonaLens on both
 * the dashboard and the terminal, so the two selectors stay visually identical
 * even though they bind to different state (command-center store vs. dashboard
 * config). Change the option styling here once; both surfaces follow.
 */
export default function PersonaMenuList({
  value,
  onSelect,
  heading = "Preset",
}: {
  value: PersonaType;
  onSelect: (p: PersonaType) => void;
  heading?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className={cn(LABEL, "px-2 py-1.5 text-slate-500")}>{heading}</span>
      {PERSONA_LIST.map((p) => {
        const Icon = p.icon;
        const selected = p.id === value;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
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
  );
}
