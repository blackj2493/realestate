/**
 * CommuteFilter — destination + mode + max-time control for the commute-zone
 * filter. Lives in the TopCommandBar; applies globally across personas.
 *
 * Mapbox isochrone has no traffic/time-of-day awareness, so there is no
 * "depart at" control here. If we adopt TravelTime later, the time-of-day
 * control slots in next to the mode toggle (see TODO below).
 */

"use client";

import React from "react";
import { Car, PersonStanding, Bike, Clock, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useCommandCenterStore, type CommuteMode } from "@/lib/stores/commandCenterStore";

interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

const MODES: { id: CommuteMode; label: string; icon: typeof Car }[] = [
  { id: "driving", label: "Drive", icon: Car },
  { id: "walking", label: "Walk", icon: PersonStanding },
  { id: "cycling", label: "Cycle", icon: Bike },
];

const MODE_LABEL: Record<CommuteMode, string> = {
  driving: "drive",
  walking: "walk",
  cycling: "cycle",
};

export default function CommuteFilter() {
  const commute = useCommandCenterStore((s) => s.commute);
  const setCommute = useCommandCenterStore((s) => s.setCommute);
  const resetCommute = useCommandCenterStore((s) => s.resetCommute);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<GeocodeResult[]>([]);
  const [searching, setSearching] = React.useState(false);

  const panelRef = React.useRef<HTMLDivElement>(null);
  const geocodeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = commute.enabled && !!commute.destination;

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Debounced geocoding autocomplete
  React.useEffect(() => {
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    geocodeTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(Array.isArray(data?.results) ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    };
  }, [query]);

  const selectDestination = (r: GeocodeResult) => {
    setCommute({ destination: r, enabled: true });
    setQuery(r.label);
    setResults([]);
  };

  const clear = () => {
    resetCommute();
    setQuery("");
    setResults([]);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between gap-2 border px-3 py-2 text-xs font-mono uppercase tracking-wider transition-all",
          active
            ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
            : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200"
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" />
          {active && commute.destination ? (
            <span className="truncate normal-case">
              {commute.minutes}m {MODE_LABEL[commute.mode]} · {commute.destination.label.split(",")[0]}
            </span>
          ) : (
            "Commute Layer"
          )}
        </span>
        {active ? (
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
          {/* Destination */}
          <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Commute to
          </label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Address, station, or place…"
              className="h-9 border-slate-700 bg-slate-950 pl-10 text-sm text-slate-200 placeholder:text-slate-500"
            />
          </div>
          {(results.length > 0 || searching) && (
            <div className="mt-1 overflow-hidden rounded-none border border-slate-700 bg-slate-950">
              {searching && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-500">Searching…</div>
              )}
              {results.map((r, i) => (
                <button
                  key={`${r.lat},${r.lng},${i}`}
                  type="button"
                  onClick={() => selectDestination(r)}
                  className="block w-full truncate px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}

          {/* Mode */}
          <label className="mb-1.5 mt-4 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Travel mode
          </label>
          <div className="flex gap-1.5">
            {MODES.map((m) => {
              const Icon = m.icon;
              const selected = commute.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setCommute({ mode: m.id })}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-none border px-2 py-1.5 text-xs font-medium transition-all",
                    selected
                      ? "border-cyan-600/50 bg-cyan-900/30 text-cyan-300"
                      : "border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
          {/* TODO(TravelTime): time-of-day "depart at" control for traffic-aware driving + transit */}

          {/* Max time */}
          <div className="mb-1.5 mt-4 flex items-center justify-between">
            <label className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Max time
            </label>
            <span className="font-mono text-xs text-cyan-300">{commute.minutes} min</span>
          </div>
          <Slider
            value={[commute.minutes]}
            onValueChange={([v]) => setCommute({ minutes: v })}
            min={5}
            max={60}
            step={5}
          />

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={clear}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
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
        </div>
      )}
    </div>
  );
}
