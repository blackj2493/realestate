"use client";

import { SlidersHorizontal } from "lucide-react";
import PersonaSwitcher from "@/components/dashboard/PersonaSwitcher";
import type { PersonaType } from "@/lib/personas/personaConfig";

/**
 * Dashboard control toolbar. The logo / global search / alerts / account live
 * in the shared AppHeader, and cross-section navigation (incl. the Map Terminal)
 * now lives in the shared PrimaryNav, so this is a non-sticky secondary row
 * holding only dashboard-specific controls: workspace label, persona switcher,
 * and Customize.
 */
export default function MissionControlHeader({
  name,
  persona,
  onPersonaChange,
  onToggleConfig,
}: {
  name?: string;
  persona: PersonaType;
  onPersonaChange: (p: PersonaType) => void;
  onToggleConfig: () => void;
}) {
  return (
    <div className="border-b border-slate-800/60 bg-slate-950/60">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
        <span className="terminal-font text-[11px] uppercase tracking-[0.2em] text-slate-400">
          {name ? (
            <>
              Workspace: <span className="text-slate-200">{name}</span> · Mission Control
            </>
          ) : (
            "Mission Control"
          )}
        </span>

        <div className="flex items-center gap-3">
          <PersonaSwitcher persona={persona} onChange={onPersonaChange} />
          <button
            type="button"
            onClick={onToggleConfig}
            className="terminal-font inline-flex shrink-0 items-center gap-1.5 border border-slate-700 px-3 py-2 text-[11px] uppercase tracking-wider text-slate-300 transition-colors hover:border-slate-500"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Customize
          </button>
        </div>
      </div>
    </div>
  );
}
