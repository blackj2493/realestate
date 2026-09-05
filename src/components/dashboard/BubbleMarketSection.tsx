/**
 * BubbleMarketSection — one full dashboard section per saved Market Bubble.
 *
 * Mirrors the per-city section block in src/app/dashboard/page.tsx: the same
 * MarketActivityPanel + RegionStatTiles + PlaylistBoard grid that Brampton /
 * Mississauga get, but scoped to the bubble's polygon (draw / commute) or
 * NearbySchools membership (school) via the Area abstraction.
 *
 * Bubble-specific chrome (rename inline, delete with confirm, "Open in Terminal"
 * link) lives in the section header rather than the grid, since these actions
 * belong to the saved-area object itself and shouldn't be confused with the
 * generic per-region playlist rows.
 *
 * Data-gap pieces handled by the downstream components:
 *   - MarketPulse (24-month price trend) is skipped entirely for bubbles —
 *     not rendered here. Phase 2C will add a polygon-aware variant.
 *
 * The SOLD column no longer degrades for polygon/school areas: Phase 2B gave the
 * sold_listings collection both `location` and `NearbySchools` (soldListingsSchema.ts),
 * so every area kind answers and there is no `supportsSold` gate to respect.
 */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellOff,
  Compass,
  ExternalLink,
  GraduationCap,
  MapPin,
  Mail,
  MoreHorizontal,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildFiltersSnapshot, type Bubble } from "@/lib/bubbles/serialize";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { bubbleToArea } from "@/lib/dashboard/area";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import type { BoardDef } from "@/lib/dashboard/boards";
import MarketActivityPanel from "./MarketActivityPanel";
import RegionStatTiles from "./RegionStatTiles";
import PlaylistBoard from "./PlaylistBoard";
import RegionDrilldown, { sectionSummary } from "./RegionDrilldown";

interface Props {
  bubble: Bubble;
  lens: MarketActivityLens;
  enabledBoards: BoardDef[];
  /** Renders a brief flash when true (used for the ?bubble=<id> deep link). */
  highlight?: boolean;
  /** Set on the FIRST bubble only — see RegionDrilldown.autoOpenFirstRun. */
  autoOpenFirstRun?: boolean;
}

const AREA_ICON: Record<Bubble["area_type"], typeof MapPin> = {
  draw: MapPin,
  commute: Compass,
  school: GraduationCap,
  // City alert rows are filtered out of BubbleSections; entry satisfies the Record type.
  city: MapPin,
};

function tagline(b: Bubble): string {
  if (b.area_type === "commute" && b.source.kind === "commute") {
    return `${b.source.minutes}-min ${b.source.mode} to ${b.source.destination.label}`;
  }
  if (b.area_type === "school" && b.source.kind === "school") {
    return `Around ${b.source.schoolName}`;
  }
  return "Custom pocket sketched on the map";
}

/**
 * Kebab menu lifted from the deprecated BubbleCard. Local state lives here
 * so the parent section stays declarative.
 */
function BubbleSectionMenu({ bubble }: { bubble: Bubble }) {
  const router = useRouter();
  const rename = useBubblesStore((s) => s.rename);
  const remove = useBubblesStore((s) => s.remove);
  const updateAlertFilters = useBubblesStore((s) => s.updateAlertFilters);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(bubble.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const commitRename = async () => {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed || trimmed === bubble.name) {
      setRenaming(false);
      setName(bubble.name);
      return;
    }
    await rename(bubble.id, trimmed);
    setRenaming(false);
  };

  if (renaming) {
    return (
      <input
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value.slice(0, 80))}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") {
            setRenaming(false);
            setName(bubble.name);
          }
        }}
        className="border-b border-cyan-500/40 bg-transparent px-1 text-sm text-foreground outline-none"
      />
    );
  }

  return (
    <div className="relative flex items-center gap-1" ref={menuRef}>
      {confirmDelete ? (
        <span className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-300">
          Delete?
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="border border-border px-2 py-0.5 text-[11px] text-foreground hover:border-border"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              setConfirmDelete(false);
              await remove(bubble.id);
            }}
            className="border border-rose-500/60 bg-rose-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-rose-700 dark:bg-rose-500/15 dark:text-rose-200 dark:hover:bg-rose-500/25"
          >
            Delete
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
          aria-label="Bubble actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
      {menuOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 border border-border bg-card py-1 shadow-lg">
          {/* Below `sm` this is the only place the Terminal link exists — the header row
              carries one control, not four (see RegionDrilldown's MOBILE note). */}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              router.push(`/properties?bubble=${encodeURIComponent(bubble.id)}`);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-foreground hover:bg-muted sm:hidden"
          >
            <ExternalLink className="h-3 w-3" /> Open in Terminal
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(true);
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
          >
            <Pencil className="h-3 w-3" /> Rename
          </button>
          {/* One-click in-place capture (owner ask): copies the Map Terminal's
              CURRENT filters onto this bubble and switches its alerts to
              "My filters" — no save-plus-delete dance. Open the Terminal first
              to set the filters you want captured. */}
          {bubble.area_type !== "city" && (
            <button
              type="button"
              title="Copies the Map's current filters to this area and switches its nightly alerts to 'My filters'. Open the Map and set your filters first."
              onClick={() => {
                const s = useCommandCenterStore.getState();
                void updateAlertFilters(
                  bubble.id,
                  buildFiltersSnapshot({
                    activePersona: s.activePersona,
                    filters: s.filters,
                    location: s.location,
                    commute: s.commute,
                    school: s.school,
                    universalFilters: s.universalFilters,
                    transactionMode: s.transactionMode,
                    propertyClass: s.propertyClass,
                  })
                );
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="h-3 w-3" /> Capture current filters
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(true);
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-500/10 dark:text-rose-300"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Per-bubble nightly new-listing alert toggle (default ON — migration 034).
 * Optimistic flip via the bubbles store; pre-034 rows lack the field and are
 * treated as ON, matching the column default.
 */
function BubbleAlertToggle({
  bubble,
  variant = "row",
}: {
  bubble: Bubble;
  /**
   * "row" — the header pair: scope control (`lg` and up) plus the bell.
   * "detail" — the scope control alone, full width, for the narrow body. At ~186px the
   * segmented control is the widest thing in the action cluster, and on the header's
   * flex line it squeezed the title to an ellipsis. It gets its own line instead.
   */
  variant?: "row" | "detail";
}) {
  const setAlertsEnabled = useBubblesStore((s) => s.setAlertsEnabled);
  const setAlertScope = useBubblesStore((s) => s.setAlertScope);
  const enabled = bubble.alerts_enabled !== false;
  // The 'filtered' scope needs a 095-era snapshot (universal basics captured at
  // save time). Older bubbles must be re-saved in the terminal to enable it —
  // we never guess filters the user didn't choose as alert rules.
  const hasSnapshot = Boolean(
    bubble.filters && "universalFilters" in bubble.filters && bubble.filters.universalFilters
  );
  const scope: "all" | "filtered" = bubble.alert_scope === "filtered" ? "filtered" : "all";
  const detail = variant === "detail";
  return (
    <>
      {/* Always visible while alerts are on (city bells excepted — whole-city by
          design). Hiding it on pre-095 bubbles made the feature undiscoverable
          (owner: "I don't see it") — now "My filters" renders DISABLED with the
          re-save instruction instead of silently not existing.

          Below `lg` it moves off the header row into `mobileDetail`, where it gets a
          full line and 44px segments instead of crushing the title. */}
      {enabled && bubble.area_type !== "city" && (
        <div
          className={cn(
            "terminal-font items-stretch border border-border text-[10px] uppercase tracking-wider",
            detail ? "flex w-full" : "hidden lg:flex"
          )}
          role="group"
          aria-label="Alert scope"
          title="What the nightly email matches: every new listing in this area, or only ones matching the filters saved with this bubble"
        >
          {/* Mail glyph = this control is about the EMAIL, not the dashboard view
              (owner: "All / My filters" alone was ambiguous). */}
          <span className="flex items-center border-r border-border px-1.5 text-muted-foreground" aria-hidden="true">
            <Mail className="h-3 w-3" />
          </span>
          {(
            [
              ["all", "All listings"],
              ["filtered", "My filters only"],
            ] as const
          ).map(([value, label]) => {
            const locked = value === "filtered" && !hasSnapshot;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                aria-disabled={locked}
                title={
                  locked
                    ? "This area was saved before filters were captured. Open it in the Terminal, set your filters, and Save it again to enable filtered alerts."
                    : undefined
                }
                onClick={() => {
                  if (locked || scope === value) return;
                  setAlertScope(bubble.id, value);
                }}
                className={cn(
                  "transition-colors",
                  detail ? "min-h-[44px] flex-1 px-3" : "px-2 py-1",
                  locked
                    ? "cursor-not-allowed text-muted-foreground/50"
                    : scope === value
                      ? "bg-cyan-600/15 font-bold text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300"
                      : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {/* The bell stays on the header row at every width — muting an area is the one
          alert action worth a tap on a phone. `detail` renders the scope pair only. */}
      {!detail && (
        <button
          type="button"
          onClick={() => setAlertsEnabled(bubble.id, !enabled)}
          aria-pressed={enabled}
          title={
            enabled
              ? "New-listing alerts ON — click to mute this area"
              : "New-listing alerts muted — click to enable"
          }
          className={cn(
            "flex h-11 w-11 items-center justify-center border transition-colors sm:h-7 sm:w-7",
            enabled
              ? "border-cyan-600/50 bg-cyan-600/10 text-cyan-700 hover:bg-cyan-600/20 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/20"
              : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
        >
          {enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
        </button>
      )}
    </>
  );
}

export default function BubbleMarketSection({
  bubble,
  lens,
  enabledBoards,
  highlight,
  autoOpenFirstRun,
}: Props) {
  const router = useRouter();
  const area = useMemo(() => bubbleToArea(bubble), [bubble]);
  const Icon = AREA_ICON[bubble.area_type];

  return (
    <RegionDrilldown
      id={`bubble-section-${bubble.id}`}
      className={cn(
        highlight && "ring-2 ring-cyan-500/70 ring-offset-2 ring-offset-slate-950"
      )}
      // Deep-linked bubble (?bubble=<id>) opens expanded so the flash lands on data.
      defaultExpanded={highlight}
      autoOpenFirstRun={autoOpenFirstRun}
      persistKey={`bubble:${bubble.id}`}
      // Counts props already in hand — the peek costs no request, which is the whole
      // point of keeping the section collapsed until asked.
      summary={sectionSummary(lens, enabledBoards.length)}
      icon={
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-600/15 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300">
          <Icon className="h-4 w-4" />
        </div>
      }
      title={bubble.name}
      subtitle={tagline(bubble)}
      mobileDetail={<BubbleAlertToggle bubble={bubble} variant="detail" />}
      actions={
        <>
          {/* A GHOST, not a bordered button. It used to hold the top-right slot the eye
              treats as "the button for this row", so it collected the presses meant for
              the drill-down. It keeps its label on desktop and moves into the kebab on
              a phone. */}
          <button
            type="button"
            onClick={() =>
              router.push(`/properties?bubble=${encodeURIComponent(bubble.id)}`)
            }
            className="terminal-font hidden items-center gap-1 px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-cyan-700 dark:hover:text-cyan-200 sm:flex"
          >
            <ExternalLink className="h-3 w-3" /> Open in Terminal
          </button>
          <BubbleAlertToggle bubble={bubble} />
          <BubbleSectionMenu bubble={bubble} />
        </>
      }
    >
      <MarketActivityPanel area={area} lens={lens} />

      <RegionStatTiles area={area} lens={lens} />

      {enabledBoards.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No boards enabled — add metrics via Add Markets.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {enabledBoards.map((b) => (
            <PlaylistBoard key={b.id} board={b} area={area} lens={lens} />
          ))}
        </div>
      )}
    </RegionDrilldown>
  );
}
