"use client";

import { useState } from "react";
import { Check, Plus, ArrowRight, MapPin, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import LocationSearch from "@/components/CommandCenter/LocationSearch";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";
import { QUICK_PICK_MARKETS } from "@/lib/dashboard/area";
import { regionResolves } from "@/lib/dashboard/regionResolves";
import { BOARDS, DEFAULT_BOARD_ORDER, type BoardId } from "@/lib/dashboard/boards";

/**
 * The dashboard's ONE workspace editor: the market areas you track, and the metric boards
 * that render under each of them.
 *
 * It used to be two panels — FirstRunRegionPicker (first run only, areas) and
 * DashboardConfigPanel ("Customize Workspace", areas AND boards, its own typeahead). Same
 * task, two entry points that looked nothing alike, and only one of them was reachable once
 * you had areas. This is the merged survivor; the config panel is gone.
 *
 * Area edits are DELEGATED to the dashboard's own addRegion/removeRegion, never applied to
 * `config.regions` here. Editing regions directly is exactly how an area could leave the
 * dashboard while its nightly alert row (`market_bubbles`, a different table) kept emailing
 * — and once the section was gone there was no bell left to mute it with. Boards go through
 * onToggleBoard; they have no server-side twin.
 *
 * Auto-apply: this is a CONTROLLED, live editor — every add/remove writes straight through,
 * so each area's scorecard + playlists appear in the dashboard the instant it is added, and
 * vanish when removed. There is no stage-then-commit step (users were doing the work but not
 * clicking the old "Enter your terminal" button, so the dashboard stayed empty — see
 * PostHog). "Done" just collapses this card; everything is already live, and
 * TrackedMarketsBar takes over as the collapsed view.
 */
// One-tap markets — shared with the /welcome first-run seed so both surfaces offer the
// same starting areas. See QUICK_PICK_MARKETS for why Toronto/Ottawa are groups. Only
// the names matter here; the cameras on those entries are for the terminal's ?near= seed.
const QUICK_PICKS = QUICK_PICK_MARKETS.map((m) => m.name);

export default function MarketPicker({
  selected,
  boards,
  onAdd,
  onRemove,
  onToggleBoard,
  onDone,
}: {
  /** Live regions from config.regions (controlled). */
  selected: string[];
  /** Live board ids from config.boards (controlled). */
  boards: BoardId[];
  onAdd: (area: string) => void;
  onRemove: (area: string) => void;
  onToggleBoard: (id: BoardId) => void;
  /** Collapse the card (everything is already applied). */
  onDone: () => void;
}) {
  const has = selected.length > 0;
  // Typed-search adds are verified before they are saved; quick picks are curated, so
  // they stay instant. LocationSearch's Enter path hands us ANY string the user typed
  // (resolveTextTarget), including a street address — saved raw, that becomes a section
  // that can never fill. See regionResolves for why the check is a count, not a regex.
  const [checking, setChecking] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const addSearched = async (label: string) => {
    setRejected(null);
    setChecking(true);
    try {
      if (await regionResolves(label)) onAdd(label);
      else setRejected(label);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="border border-dashed border-border bg-card/40 px-6 py-8 text-center">
      {/* First run is an onboarding moment; every reopen after that is an edit. */}
      <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-foreground">
        {has ? "Your workspace" : "Set up your terminal"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Add the cities or neighbourhoods you invest in — each one loads into your dashboard
        below the moment you add it.
      </p>

      {/* Typeahead for any city/neighbourhood. onPlace adds it live, once it resolves. */}
      <div className="mx-auto mt-6 max-w-md text-left">
        <LocationSearch
          mode="inplace"
          onPlace={(label) => void addSearched(label)}
          placeholder="Search a city or neighbourhood…"
        />
        {checking && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking that area…
          </p>
        )}
        {rejected && !checking && (
          // Name what was rejected: the usual cause is a full street address typed into a
          // market box, and the user cannot tell that from a generic failure.
          <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            We have no listings filed under &ldquo;{rejected}&rdquo;. Market areas are cities
            and neighbourhoods — for one address, search it from the map instead.
          </p>
        )}
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

      {/* Live selection as removable chips (each already loaded below). */}
      {has && (
        <div className="mx-auto mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-400" />
          {selected.map((area) => (
            <span
              key={area}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-600/50 bg-cyan-600/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-100"
              title={area}
            >
              {formatRegionLabel(area)}
              <button
                type="button"
                onClick={() => onRemove(area)}
                aria-label={`Remove ${formatRegionLabel(area)}`}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-cyan-700/70 transition-colors hover:bg-cyan-600/15 hover:text-cyan-900 dark:text-cyan-300/70 dark:hover:bg-cyan-500/25 dark:hover:text-cyan-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Tell users what adding an area does for email — alerts are on by default now
          (§176), controlled by the bell on each area's section below. */}
      {has && (
        <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">
          New-listing emails are on for each area you add. Mute or fine-tune any of them
          with the alert bell on its section below.
        </p>
      )}

      {/* Boards render INSIDE each area's drill-down, so they mean nothing until at least
          one area exists — first run stays a single decision. */}
      {has && (
        <div className="mx-auto mt-8 max-w-2xl border-t border-border pt-6 text-left">
          <h3 className="terminal-font text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Metric boards
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick the boards that appear under every area you track.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {DEFAULT_BOARD_ORDER.map((id) => {
              const on = boards.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onToggleBoard(id)}
                  aria-pressed={on}
                  className={cn(
                    "flex min-h-[44px] items-center gap-2 border px-3 py-2 text-left text-xs transition-colors",
                    on
                      ? "border-cyan-600/60 bg-cyan-600/10 text-cyan-700 dark:border-cyan-500/50 dark:bg-cyan-500/10 dark:text-cyan-200"
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
      )}

      {/* "Done" just collapses this card — everything above is already live. */}
      <button
        type="button"
        disabled={!has}
        onClick={onDone}
        className="terminal-font mt-6 inline-flex min-h-[44px] items-center gap-2 border border-cyan-600 bg-cyan-600 px-5 py-3 text-xs uppercase tracking-wider text-white transition-colors hover:bg-cyan-700 disabled:opacity-40 dark:border-cyan-500/50 dark:bg-cyan-500/10 dark:text-cyan-200 dark:hover:bg-cyan-500/20"
      >
        {has ? `Done · ${selected.length} ${selected.length === 1 ? "area" : "areas"}` : "Add an area to begin"}
        {has && <ArrowRight className="h-4 w-4" />}
      </button>
    </div>
  );
}
