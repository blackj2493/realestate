"use client";

import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { suggestSearch, type SearchSuggestion } from "@/lib/typesense/client";
import { BOARDS, DEFAULT_BOARD_ORDER, type BoardId } from "@/lib/dashboard/boards";
import type { DashboardConfig } from "@/lib/dashboard/config";

export default function DashboardConfigPanel({
  config,
  onChange,
}: {
  config: DashboardConfig;
  onChange: (c: DashboardConfig) => void;
}) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      suggestSearch(term)
        // Market areas only — drop individual address / MLS suggestions.
        .then((r) => setSuggestions(r.filter((s) => s.kind === "city" || s.kind === "neighbourhood")))
        .catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const addRegion = (label: string) => {
    if (!label || config.regions.includes(label)) return;
    onChange({ ...config, regions: [...config.regions, label] });
    setQ("");
    setSuggestions([]);
  };
  const removeRegion = (label: string) =>
    onChange({ ...config, regions: config.regions.filter((r) => r !== label) });

  const toggleBoard = (id: BoardId) => {
    const on = config.boards.includes(id);
    onChange({
      ...config,
      boards: on ? config.boards.filter((b) => b !== id) : [...config.boards, id],
    });
  };

  return (
    <div className="border border-border bg-card/60 p-4">
      <h2 className="terminal-font mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-400">
        Customize Workspace
      </h2>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Market areas */}
        <div>
          <label className="terminal-font mb-2 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Market Areas
          </label>
          <div className="mb-2 flex flex-wrap gap-2">
            {config.regions.length === 0 && (
              <span className="text-xs text-muted-foreground">None added yet.</span>
            )}
            {config.regions.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1.5 border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200"
              >
                {r}
                <button
                  type="button"
                  onClick={() => removeRegion(r)}
                  aria-label={`Remove ${r}`}
                  className="text-cyan-300/70 hover:text-rose-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Add a city or neighbourhood…"
              type="search"
              inputMode="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              className="w-full border border-border bg-card/60 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-500/60"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto border border-border bg-card shadow-lg">
                {suggestions.map((s) => (
                  <li key={`${s.kind}:${s.label}`}>
                    <button
                      type="button"
                      onClick={() => addRegion(s.label)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                    >
                      <span className="flex items-center gap-2">
                        <Plus className="h-3 w-3 text-cyan-400" />
                        {s.label}
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {s.kind}
                        </span>
                      </span>
                      {s.count != null && (
                        <span className="terminal-font text-[10px] text-muted-foreground">
                          {s.count}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Boards / metrics */}
        <div>
          <label className="terminal-font mb-2 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Metric Boards
          </label>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {DEFAULT_BOARD_ORDER.map((id) => {
              const on = config.boards.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleBoard(id)}
                  className={cn(
                    "flex items-center gap-2 border px-3 py-2 text-left text-xs transition-colors",
                    on
                      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200"
                      : "border-border bg-card/40 text-muted-foreground hover:border-border"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center border",
                      on ? "border-cyan-500 bg-cyan-500 text-slate-950" : "border-border"
                    )}
                  >
                    {on && <span className="text-[9px] font-black">✓</span>}
                  </span>
                  {BOARDS[id].title}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
