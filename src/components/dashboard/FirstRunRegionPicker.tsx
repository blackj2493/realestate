"use client";

import { Check, Plus, ArrowRight, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import LocationSearch from "@/components/CommandCenter/LocationSearch";

/**
 * First-run market-area picker. Shown on the dashboard when the user has no saved
 * regions yet (a direct magic-link signup never went through /apply, so nothing
 * seeds config.regions).
 *
 * Auto-apply: this is a CONTROLLED, live picker — every add/remove writes straight to
 * config.regions (via onAdd/onRemove), so each area's scorecard + playlists appear in the
 * dashboard the instant it's added, and vanish when removed. There is no stage-then-commit
 * step (users were doing the work but not clicking the old "Enter your terminal" button, so
 * the dashboard stayed empty — see PostHog). "Done" just collapses this setup card; the
 * areas are already live.
 */
// One-tap markets. Every entry must map to real inventory via areaFilter (see
// CITY_GROUPS in @/lib/dashboard/area). "Ottawa" was removed: TRREB files its ~1,200
// Ottawa listings under fragmented area names ("Ottawa Centre", "Orleans - …") that
// don't roll up to a single "Ottawa" City value, so a bare "Ottawa" quick-pick loaded an
// empty dashboard. Ottawa areas remain fully addable via the search box above.
const QUICK_PICKS = [
  "Toronto",
  "Mississauga",
  "Brampton",
  "Vaughan",
  "Markham",
  "Oakville",
  "Hamilton",
];

export default function FirstRunRegionPicker({
  selected,
  onAdd,
  onRemove,
  onDone,
}: {
  /** Live regions from config.regions (controlled). */
  selected: string[];
  onAdd: (area: string) => void;
  onRemove: (area: string) => void;
  /** Collapse the setup card (areas are already applied). */
  onDone: () => void;
}) {
  const has = selected.length > 0;

  return (
    <div className="border border-dashed border-slate-700 bg-slate-900/40 px-6 py-8 text-center">
      <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-slate-200">
        Set up your terminal
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
        Add the cities or neighbourhoods you invest in — each one loads into your dashboard
        below the moment you add it.
      </p>

      {/* Typeahead for any city/neighbourhood. onPlace adds it live. */}
      <div className="mx-auto mt-6 max-w-md text-left">
        <LocationSearch
          mode="inplace"
          onPlace={onAdd}
          placeholder="Search a city or neighbourhood…"
        />
      </div>

      {/* One-tap quick picks — toggle add/remove live. */}
      <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
        {QUICK_PICKS.map((city) => {
          const on = selected.includes(city);
          return (
            <button
              key={city}
              type="button"
              onClick={() => (on ? onRemove(city) : onAdd(city))}
              aria-pressed={on}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                on
                  ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                  : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              )}
            >
              {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {city}
            </button>
          );
        })}
      </div>

      {/* Live selection as removable chips (each already loaded below). */}
      {has && (
        <div className="mx-auto mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-cyan-400" />
          {selected.map((area) => (
            <span
              key={area}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-cyan-100"
            >
              {area}
              <button
                type="button"
                onClick={() => onRemove(area)}
                aria-label={`Remove ${area}`}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-cyan-300/70 transition-colors hover:bg-cyan-500/25 hover:text-cyan-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* "Done" just collapses this card — the areas are already live in the dashboard. */}
      <button
        type="button"
        disabled={!has}
        onClick={onDone}
        className="terminal-font mt-6 inline-flex min-h-[44px] items-center gap-2 border border-cyan-500/50 bg-cyan-500/10 px-5 py-3 text-xs uppercase tracking-wider text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-40"
      >
        {has ? `Done · ${selected.length} ${selected.length === 1 ? "area" : "areas"}` : "Add an area to begin"}
        {has && <ArrowRight className="h-4 w-4" />}
      </button>
    </div>
  );
}
