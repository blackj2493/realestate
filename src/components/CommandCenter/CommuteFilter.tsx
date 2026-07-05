/**
 * CommuteFilter — destination + mode + max-time control for the commute-zone filter.
 * Rendered directly inside the "Commute" drawer of the Instrument Deck rail (no chip /
 * popover wrapper — the drawer already provides the panel, header, and close button).
 * Applies globally across personas.
 *
 * Mapbox isochrone has no traffic/time-of-day awareness, so there is no "depart at"
 * control here. If we adopt TravelTime later, the time-of-day control slots in next to
 * the mode toggle (see TODO below).
 */

"use client";

import React from "react";
import { Car, PersonStanding, Bike, MapPin } from "lucide-react";
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

export default function CommuteFilter() {
  const commute = useCommandCenterStore((s) => s.commute);
  const setCommute = useCommandCenterStore((s) => s.setCommute);
  const resetCommute = useCommandCenterStore((s) => s.resetCommute);

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<GeocodeResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const geocodeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
    <div>
      {/* Destination */}
      <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Commute to
      </label>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Address, station, or place…"
          className="h-9 border-border bg-background pl-10 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
      {(results.length > 0 || searching) && (
        <div className="mt-1 overflow-hidden rounded-none border border-border bg-background">
          {searching && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lng},${i}`}
              type="button"
              onClick={() => selectDestination(r)}
              className="block w-full truncate px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* Mode */}
      <label className="mb-1.5 mt-4 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
                  ? "border-cyan-600/50 bg-cyan-900/30 text-cyan-700 dark:text-cyan-300"
                  : "border-border bg-muted text-muted-foreground hover:text-foreground"
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
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Max time
        </label>
        <span className="font-mono text-xs text-cyan-700 dark:text-cyan-300">{commute.minutes} min</span>
      </div>
      <Slider
        value={[commute.minutes]}
        onValueChange={([v]) => setCommute({ minutes: v })}
        min={5}
        max={60}
        step={5}
      />

      {/* Footer — clear the lens (the drawer's own X closes the panel). */}
      <div className="mt-4">
        <button
          type="button"
          onClick={clear}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
