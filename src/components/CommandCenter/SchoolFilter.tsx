/**
 * SchoolFilter — school-quality lens for the TopCommandBar (global across personas).
 *
 * Picks a Level×System lens (which resolves to one indexed Typesense score field), a
 * minimum "PureProperty School Score", and an optional target school. Drives the
 * listing filter, the sort, and the map shading (Phase 4). Scores are derived from
 * EQAO open data (Government of Ontario, OGL-Ontario) — see build-schools-dataset.ts.
 */

"use client";

import React from "react";
import { GraduationCap, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  useCommandCenterStore,
  type SchoolLevel,
  type SchoolSystem,
} from "@/lib/stores/commandCenterStore";

interface SchoolSearchResult {
  id: string;
  name: string;
  level: "elementary" | "secondary";
  system: "public" | "catholic";
  city: string;
  score: number | null;
}

const LEVELS: { id: SchoolLevel; label: string }[] = [
  { id: "elementary", label: "Elementary" },
  { id: "secondary", label: "Secondary" },
];
const SYSTEMS: { id: SchoolSystem; label: string }[] = [
  { id: "public", label: "Public" },
  { id: "catholic", label: "Catholic" },
  { id: "either", label: "Either" },
];

const segBtn = (selected: boolean) =>
  cn(
    "flex flex-1 items-center justify-center rounded-none border px-2 py-1.5 text-xs font-medium transition-all",
    selected
      ? "border-cyan-600/50 bg-cyan-900/30 text-cyan-300"
      : "border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200"
  );

export default function SchoolFilter() {
  const school = useCommandCenterStore((s) => s.school);
  const setSchool = useCommandCenterStore((s) => s.setSchool);
  const resetSchool = useCommandCenterStore((s) => s.resetSchool);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SchoolSearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);

  const panelRef = React.useRef<HTMLDivElement>(null);
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Debounced school-name autocomplete
  React.useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/schools/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(Array.isArray(data?.results) ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const selectTarget = (r: SchoolSearchResult) => {
    setSchool({ targetSchool: { id: r.id, name: r.name }, enabled: true });
    setQuery(r.name);
    setResults([]);
  };

  const clear = () => {
    resetSchool();
    setQuery("");
    setResults([]);
  };

  // Concise chip summary.
  const summary = () => {
    const parts: string[] = [];
    const lvl = school.level === "elementary" ? "Elem" : "Sec";
    const sys = school.system === "either" ? "Any" : school.system === "public" ? "Pub" : "Cath";
    parts.push(`${lvl}·${sys}`);
    if (school.minScore > 0) parts.push(`≥${school.minScore}`);
    if (school.targetSchool) return `near ${school.targetSchool.name.split(" ").slice(0, 3).join(" ")}`;
    return parts.join(" ");
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between gap-2 border px-3 py-2 text-xs font-mono uppercase tracking-wider transition-all",
          school.enabled
            ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
            : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200"
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <GraduationCap className="h-4 w-4 shrink-0" />
          {school.enabled ? <span className="truncate normal-case">{summary()}</span> : "School Layer"}
        </span>
        {school.enabled ? (
          <X
            className="h-4 w-4 shrink-0 text-cyan-400/70 hover:text-cyan-200"
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
          />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 bg-slate-600" />
        )}
      </button>

      {open && (
        <div className="absolute left-full top-0 z-30 ml-2 w-80 rounded-none border border-slate-700 bg-slate-900 p-4">
          {/* Level */}
          <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            School level
          </label>
          <div className="flex gap-1.5">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setSchool({ level: l.id, enabled: true })}
                className={segBtn(school.level === l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* System */}
          <label className="mb-1.5 mt-4 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            System
          </label>
          <div className="flex gap-1.5">
            {SYSTEMS.map((sysOpt) => (
              <button
                key={sysOpt.id}
                type="button"
                onClick={() => setSchool({ system: sysOpt.id, enabled: true })}
                className={segBtn(school.system === sysOpt.id)}
              >
                {sysOpt.label}
              </button>
            ))}
          </div>

          {/* Min score */}
          <div className="mb-1.5 mt-4 flex items-center justify-between">
            <label className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Min school score
            </label>
            <span className="font-mono text-xs text-cyan-300">
              {school.minScore > 0 ? `${school.minScore.toFixed(1)} / 10` : "Any"}
            </span>
          </div>
          <Slider
            value={[school.minScore]}
            onValueChange={([v]) => setSchool({ minScore: v, enabled: true })}
            min={0}
            max={10}
            step={0.5}
          />

          {/* Target school */}
          <label className="mb-1.5 mt-4 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Near a specific school
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (school.targetSchool) setSchool({ targetSchool: null });
              }}
              placeholder="Search school name…"
              className="h-9 border-slate-700 bg-slate-950 pl-10 text-sm text-slate-200 placeholder:text-slate-500"
            />
          </div>
          {(results.length > 0 || searching) && (
            <div className="mt-1 max-h-56 overflow-y-auto rounded-none border border-slate-700 bg-slate-950">
              {searching && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-500">Searching…</div>
              )}
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectTarget(r)}
                  className="block w-full px-3 py-2 text-left hover:bg-slate-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-200">{r.name}</span>
                    {r.score !== null && (
                      <span className="shrink-0 font-mono text-[10px] text-cyan-300">{r.score.toFixed(1)}</span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">
                    {r.city} · {r.system === "public" ? "Public" : "Catholic"} {r.level}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between">
            <button type="button" onClick={clear} className="text-xs text-slate-500 hover:text-slate-300">
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-none bg-cyan-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600"
            >
              Done
            </button>
          </div>
          <p className="mt-3 text-[9px] leading-tight text-slate-600">
            Scores are the PureProperty School Score, derived from EQAO results
            (Government of Ontario, OGL-Ontario). Nearest rated school — not a guaranteed
            catchment.
          </p>
        </div>
      )}
    </div>
  );
}
