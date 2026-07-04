"use client";

import { useState } from "react";
import { Check, Plus, ArrowRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import LocationSearch from "@/components/CommandCenter/LocationSearch";

/**
 * First-run market-area picker. Shown on the dashboard when the user has no saved
 * regions yet (a direct magic-link signup never went through /apply, so nothing
 * seeds config.regions). Lets them stage one or more markets — one-tap GTA quick
 * picks or a typeahead for anything else — then commit, populating the whole
 * dashboard in one step instead of leaving them on an empty "nothing yet" screen.
 */
const QUICK_PICKS = [
  "Toronto",
  "Mississauga",
  "Brampton",
  "Vaughan",
  "Markham",
  "Oakville",
  "Hamilton",
  "Ottawa",
];

export default function FirstRunRegionPicker({
  onConfirm,
}: {
  onConfirm: (regions: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  const add = (city: string) =>
    setSelected((s) => (s.includes(city) ? s : [...s, city]));
  const toggle = (city: string) =>
    setSelected((s) => (s.includes(city) ? s.filter((c) => c !== city) : [...s, city]));

  return (
    <div className="border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-foreground">
        Set up your terminal
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Add the cities or neighbourhoods you invest in to populate your investment
        playlists, region scorecards, and market intelligence.
      </p>

      {/* Typeahead for any city/neighbourhood. onPlace captures the label without
          navigating or touching the Command Center store. */}
      <div className="mx-auto mt-6 max-w-md text-left">
        <LocationSearch
          mode="inplace"
          onPlace={add}
          placeholder="Search a city or neighbourhood…"
        />
      </div>

      {/* One-tap GTA quick picks. */}
      <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
        {QUICK_PICKS.map((city) => {
          const on = selected.includes(city);
          return (
            <button
              key={city}
              type="button"
              onClick={() => toggle(city)}
              aria-pressed={on}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                on
                  ? "border-cyan-600/60 bg-cyan-600/10 text-cyan-700 dark:border-cyan-500/50 dark:bg-cyan-500/15 dark:text-cyan-200"
                  : "border-border text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {city}
            </button>
          );
        })}
      </div>

      {/* Staged selection + commit. */}
      {selected.length > 0 && (
        <div className="mx-auto mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-400" />
          <span>{selected.join(" · ")}</span>
        </div>
      )}
      <button
        type="button"
        disabled={selected.length === 0}
        onClick={() => onConfirm(selected)}
        className="terminal-font mt-6 inline-flex min-h-[44px] items-center gap-2 border border-cyan-600 bg-cyan-600 px-5 py-3 text-xs uppercase tracking-wider text-white transition-colors hover:bg-cyan-700 disabled:opacity-40 dark:border-cyan-500/50 dark:bg-cyan-500/10 dark:text-cyan-200 dark:hover:bg-cyan-500/20"
      >
        Enter your terminal
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
