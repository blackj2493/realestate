/**
 * MapLensesPanel — saved "Lenses": one-click presets that snapshot the active
 * persona + filters + color metric. Power users curate their own analytical
 * views (e.g. "GTA duplex candidates, cap-rate shaded") and reapply them
 * instantly. Persisted to localStorage; no backend needed.
 */

"use client";

import React, { useEffect, useState } from "react";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import {
  PERSONA_CONFIG,
  type PersonaType,
  type TerminalFilterState,
} from "@/lib/personas/personaConfig";

interface Lens {
  id: string;
  name: string;
  persona: PersonaType;
  filters: TerminalFilterState;
  colorMetricId: string | null;
}

const STORAGE_KEY = "pp_lenses";

function loadLenses(): Lens[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function MapLensesPanel() {
  const activePersona = useCommandCenterStore((s) => s.activePersona);
  const filters = useCommandCenterStore((s) => s.filters);
  const colorMetricId = useCommandCenterStore((s) => s.colorMetricId);
  const setActivePersona = useCommandCenterStore((s) => s.setActivePersona);
  const setFilters = useCommandCenterStore((s) => s.setFilters);
  const setColorMetricId = useCommandCenterStore((s) => s.setColorMetricId);

  const [lenses, setLenses] = useState<Lens[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    setLenses(loadLenses());
  }, []);

  const persist = (next: Lens[]) => {
    setLenses(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage full / unavailable — keep in-memory only */
    }
  };

  const save = () => {
    const label = name.trim() || `${PERSONA_CONFIG[activePersona].label} view`;
    persist([
      ...lenses,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: label,
        persona: activePersona,
        filters: { ...filters },
        colorMetricId,
      },
    ]);
    setName("");
  };

  const apply = (lens: Lens) => {
    setActivePersona(lens.persona);
    setFilters(lens.filters);
    setColorMetricId(lens.colorMetricId);
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Name this view…"
          className="h-8 min-w-0 flex-1 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-1 border border-cyan-500/50 bg-cyan-500/15 px-2.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25"
        >
          <Plus className="h-3.5 w-3.5" /> Save
        </button>
      </div>

      {lenses.length === 0 ? (
        <p className="px-0.5 py-2 text-[11px] leading-relaxed text-slate-500">
          No saved lenses yet. Set up a persona, filters and color, then save it here to recall
          the whole view in one click.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {lenses.map((lens) => (
            <div
              key={lens.id}
              className="group flex items-center gap-2 border border-slate-800 bg-slate-900 px-2 py-1.5"
            >
              <Bookmark className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
              <button
                type="button"
                onClick={() => apply(lens)}
                className="min-w-0 flex-1 text-left"
                title="Apply this lens"
              >
                <p className="truncate text-xs font-medium text-slate-200 group-hover:text-cyan-200">{lens.name}</p>
                <p className="truncate text-[10px] text-slate-500">{PERSONA_CONFIG[lens.persona].label}</p>
              </button>
              <button
                type="button"
                onClick={() => persist(lenses.filter((l) => l.id !== lens.id))}
                aria-label="Delete lens"
                className="shrink-0 text-slate-600 hover:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
