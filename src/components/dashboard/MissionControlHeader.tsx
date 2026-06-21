"use client";

import { Plus } from "lucide-react";
import PersonaLens from "@/components/dashboard/PersonaLens";
import type { PersonaType } from "@/lib/personas/personaConfig";

/**
 * Dashboard control toolbar. The logo / global search / alerts / account live
 * in the shared AppHeader, and cross-section navigation (incl. the Map Terminal)
 * now lives in the shared PrimaryNav, so this is a non-sticky secondary row
 * holding only dashboard-specific controls: workspace label, the persona lens
 * (centered as the page's centerpiece), and Add Markets.
 *
 * Layout: a 3-column grid on lg+ so the persona lens sits dead-center regardless
 * of how wide the workspace label / button are; stacks and centers on narrow
 * viewports.
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
      <div className="flex flex-col items-center gap-3 px-4 py-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-4">
        {/* Left: workspace label */}
        <span className="terminal-font text-center text-[11px] uppercase tracking-[0.2em] text-slate-400 lg:justify-self-start lg:text-left">
          {name ? (
            <>
              Workspace: <span className="text-slate-200">{name}</span> · Mission Control
            </>
          ) : (
            "Mission Control"
          )}
        </span>

        {/* Center: the persona lens — the dashboard's hero control */}
        <div className="lg:justify-self-center">
          <PersonaLens persona={persona} onChange={onPersonaChange} />
        </div>

        {/* Right: add a city / neighbourhood (+ configure boards) */}
        <div className="lg:justify-self-end">
          <button
            type="button"
            data-tour="dashboard-config"
            onClick={onToggleConfig}
            className="terminal-font inline-flex shrink-0 items-center gap-1.5 border border-slate-700 px-3 py-2 text-[11px] uppercase tracking-wider text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
          >
            <Plus className="h-3.5 w-3.5 text-cyan-400" /> Add Markets
          </button>
        </div>
      </div>
    </div>
  );
}
