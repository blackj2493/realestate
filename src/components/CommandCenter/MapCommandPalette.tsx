/**
 * MapCommandPalette — ⌘K / Ctrl+K power-user launcher. Jump to a city, switch
 * persona or map mode, open any rail drawer, change the color metric, or toggle
 * the timeline — all from the keyboard. Surfaces the terminal's depth without
 * cluttering the chrome.
 */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_LIST, type MapMode } from "@/lib/personas/personaConfig";
import { MAP_METRICS } from "@/lib/personas/mapMetrics";
import { FILTERS_BY_KEY } from "@/lib/filters/filterRegistry";
import { parseFilterCommands, type FilterCommand } from "./filterCommands";

interface Command {
  id: string;
  label: string;
  group: string;
  run: () => void;
}

const MODES: { id: MapMode; label: string }[] = [
  { id: "listings", label: "Listings" },
  { id: "heatmap", label: "Heatmap" },
  { id: "3d", label: "3D Explore" },
];

export default function MapCommandPalette() {
  const open = useCommandCenterStore((s) => s.paletteOpen);
  const setOpen = useCommandCenterStore((s) => s.setPaletteOpen);
  const togglePalette = useCommandCenterStore((s) => s.togglePalette);
  const setActivePersona = useCommandCenterStore((s) => s.setActivePersona);
  const setMapMode = useCommandCenterStore((s) => s.setMapMode);
  const setActiveModule = useCommandCenterStore((s) => s.setActiveModule);
  const setLocation = useCommandCenterStore((s) => s.setLocation);
  const setColorMetricId = useCommandCenterStore((s) => s.setColorMetricId);
  const setTimelineActive = useCommandCenterStore((s) => s.setTimelineActive);
  const timelineActive = useCommandCenterStore((s) => s.timelineActive);
  const setUniversalFilter = useCommandCenterStore((s) => s.setUniversalFilter);
  const addFilter = useCommandCenterStore((s) => s.addFilter);
  const transactionMode = useCommandCenterStore((s) => s.transactionMode);
  const propertyClass = useCommandCenterStore((s) => s.propertyClass);

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl+K toggle (and Esc to close).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette, setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = () => setOpen(false);

  // Apply a parsed filter action via the same store setters the chips/drawer use.
  // Enums merge into the current selection (read at click-time via getState, so the
  // palette needn't subscribe to every filter change); pinned basics aren't "added".
  const runFilterCommand = (fc: FilterCommand) => {
    if (fc.control === "enum") {
      const current = (useCommandCenterStore.getState().universalFilters[fc.key] as string[]) ?? [];
      const next = current.includes(fc.option) ? current : [...current, fc.option];
      setUniversalFilter(fc.key, next);
    } else {
      setUniversalFilter(fc.key, fc.value);
    }
    if (!FILTERS_BY_KEY[fc.key]?.defaultPinned) addFilter(fc.key);
    close();
  };

  const commands: Command[] = useMemo(() => {
    const list: Command[] = [];
    PERSONA_LIST.forEach((p) =>
      list.push({ id: `persona-${p.id}`, group: "Persona", label: p.label, run: () => { setActivePersona(p.id); close(); } })
    );
    MODES.forEach((m) =>
      list.push({ id: `mode-${m.id}`, group: "Map mode", label: m.label, run: () => { setMapMode(m.id); close(); } })
    );
    ([
      ["commute", "Commute"],
      ["school", "Schools"],
      ["color", "Color By"],
      ["draw", "Draw Area"],
      ["compare", "Compare"],
      ["lenses", "Saved Views"],
    ] as const).forEach(([mod, label]) =>
      list.push({ id: `open-${mod}`, group: "Open", label: `Open ${label}`, run: () => { setActiveModule(mod); close(); } })
    );
    list.push({ id: "color-default", group: "Color by", label: "Color: Persona default", run: () => { setColorMetricId(null); close(); } });
    MAP_METRICS.forEach((m) =>
      list.push({ id: `color-${m.id}`, group: "Color by", label: `Color: ${m.label}`, run: () => { setColorMetricId(m.id); close(); } })
    );
    list.push({ id: "timeline", group: "View", label: timelineActive ? "Hide timeline" : "Show timeline", run: () => { setTimelineActive(!timelineActive); close(); } });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineActive]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;

    // Parsed filter actions lead — typing "under 800k" or "4bd" should resolve to a
    // filter, not a city search. An "Apply all" row fronts a multi-filter query.
    const parsed = parseFilterCommands(query, { transactionMode, propertyClass });
    const filterCmds: Command[] = parsed.map((fc) => ({
      id: `filter-${fc.id}`,
      group: "Filter",
      label: fc.label,
      run: () => runFilterCommand(fc),
    }));
    if (parsed.length > 1) {
      filterCmds.unshift({
        id: "filter-all",
        group: "Filter",
        label: `Apply all — ${parsed.map((p) => p.label).join(" · ")}`,
        run: () => parsed.forEach(runFilterCommand),
      });
    }

    const matched = commands.filter((c) => c.label.toLowerCase().includes(q));
    const goto: Command = {
      id: "goto",
      group: "Search",
      label: `Search “${query.trim()}”`,
      run: () => { setLocation(query.trim()); close(); },
    };
    return [...filterCmds, ...matched, goto];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, commands, transactionMode, propertyClass]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[highlight]?.run();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 pt-[12vh] backdrop-blur-sm" onClick={close}>
      <div
        className="w-full max-w-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={onKeyDown}
            placeholder="Filter (4bd, under 800k, finished basement), jump to a city, switch mode…"
            className="h-11 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-slate-500">No matches</p>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => c.run()}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                  i === highlight ? "bg-cyan-500/15 text-cyan-100" : "text-slate-300"
                )}
              >
                <span className="truncate">{c.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-600">{c.group}</span>
                  {i === highlight && <CornerDownLeft className="h-3.5 w-3.5 text-cyan-300" />}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
