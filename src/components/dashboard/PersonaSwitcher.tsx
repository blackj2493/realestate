"use client";

import { PERSONA_LIST, type PersonaType } from "@/lib/personas/personaConfig";

/**
 * Compact segmented control for the active dashboard persona. Reshapes which
 * boards/metrics lead across the dashboard (see personaDashboard.ts). Terminal
 * aesthetic: uppercase tracking labels, cyan active state. On narrow screens the
 * labels collapse to icons only.
 */
export default function PersonaSwitcher({
  persona,
  onChange,
}: {
  persona: PersonaType;
  onChange: (p: PersonaType) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Investor persona"
      className="flex shrink-0 items-center border border-slate-700 bg-slate-900/60"
    >
      {PERSONA_LIST.map((p) => {
        const Icon = p.icon;
        const active = p.id === persona;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={p.label}
            title={p.label}
            onClick={() => onChange(p.id as PersonaType)}
            className={`terminal-font inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 px-2.5 py-3 text-[11px] uppercase tracking-wider transition-colors ${
              active
                ? "bg-cyan-500 text-slate-950"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
