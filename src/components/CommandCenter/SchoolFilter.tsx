/**
 * SchoolFilter — school-quality lens + catchment-zone controls. Rendered directly
 * inside the Schools drawer of the Instrument Deck rail (MapDrawer), so it shows its
 * controls inline — no chip / popover wrapper (the drawer already provides the panel,
 * header, and close button).
 *
 * Picks a Level×System lens (which resolves to one indexed Typesense score field), a
 * minimum "PureProperty School Score", an optional target school, and toggles the
 * attendance-boundary overlay. Scores are derived from EQAO open data (Government of
 * Ontario, OGL-Ontario) — see build-schools-dataset.ts.
 */

"use client";

import React from "react";
import { Search, Map as MapIcon } from "lucide-react";
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

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SchoolSearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <div>
      {/* Catchment-zone overlay — draws real attendance boundaries on the map. */}
      <button
        type="button"
        onClick={() => setSchool({ showZones: !school.showZones })}
        className={cn(
          "mb-2 flex w-full items-center justify-between border px-3 py-2 text-xs font-medium transition-all",
          school.showZones
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
            : "border-slate-700 bg-slate-800 text-slate-300 hover:text-slate-100"
        )}
      >
        <span className="flex items-center gap-2">
          <MapIcon className="h-3.5 w-3.5" /> Show catchment zones on map
        </span>
        <span
          className={cn(
            "h-3 w-6 rounded-full transition-colors",
            school.showZones ? "bg-emerald-500" : "bg-slate-600"
          )}
        />
      </button>
      <p className="mb-4 text-[9px] leading-tight text-slate-600">
        Official attendance boundaries where boards publish them (
        {school.level === "elementary" ? "elementary" : "secondary"},{" "}
        {school.system === "either" ? "public + catholic" : school.system}). Boundaries
        change yearly — verify with the board.
      </p>

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

      {/* Footer — clear the lens (the drawer's own X closes the panel). */}
      <div className="mt-4">
        <button type="button" onClick={clear} className="text-xs text-slate-500 hover:text-slate-300">
          Clear
        </button>
      </div>
      <p className="mt-3 text-[9px] leading-tight text-slate-600">
        Scores are the PureProperty School Score, derived from EQAO results
        (Government of Ontario, OGL-Ontario). Nearest rated school — not a guaranteed
        catchment.
      </p>
    </div>
  );
}
