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
 *   - SOLD column of MarketActivityPanel degrades to a placeholder for non-
 *     region areas (see supportsSold() in src/lib/dashboard/area.ts).
 *   - MarketPulse (24-month price trend) is skipped entirely for bubbles —
 *     not rendered here. Phase 2C will add a polygon-aware variant.
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
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Bubble } from "@/lib/bubbles/serialize";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import { bubbleToArea } from "@/lib/dashboard/area";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import type { BoardDef } from "@/lib/dashboard/boards";
import MarketActivityPanel from "./MarketActivityPanel";
import RegionStatTiles from "./RegionStatTiles";
import PlaylistBoard from "./PlaylistBoard";
import RegionDrilldown from "./RegionDrilldown";

interface Props {
  bubble: Bubble;
  lens: MarketActivityLens;
  enabledBoards: BoardDef[];
  /** Renders a brief flash when true (used for the ?bubble=<id> deep link). */
  highlight?: boolean;
}

const AREA_ICON: Record<Bubble["area_type"], typeof MapPin> = {
  draw: MapPin,
  commute: Compass,
  school: GraduationCap,
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
  const rename = useBubblesStore((s) => s.rename);
  const remove = useBubblesStore((s) => s.remove);

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
        <span className="flex items-center gap-2 text-xs text-rose-300">
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
            className="border border-rose-500/60 bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-200 hover:bg-rose-500/25"
          >
            Delete
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Bubble actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
      {menuOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 border border-border bg-card py-1 shadow-lg">
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
          <button
            type="button"
            onClick={() => {
              setConfirmDelete(true);
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-500/10"
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
function BubbleAlertToggle({ bubble }: { bubble: Bubble }) {
  const setAlertsEnabled = useBubblesStore((s) => s.setAlertsEnabled);
  const enabled = bubble.alerts_enabled !== false;
  return (
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
        "flex h-7 w-7 items-center justify-center border transition-colors",
        enabled
          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
          : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      {enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function BubbleMarketSection({
  bubble,
  lens,
  enabledBoards,
  highlight,
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
      icon={
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-500/15 text-cyan-300">
          <Icon className="h-4 w-4" />
        </div>
      }
      title={bubble.name}
      subtitle={tagline(bubble)}
      actions={
        <>
          <button
            type="button"
            onClick={() =>
              router.push(`/properties?bubble=${encodeURIComponent(bubble.id)}`)
            }
            className="terminal-font flex items-center gap-1 border border-border px-2.5 py-1 text-[11px] uppercase tracking-wider text-foreground hover:border-cyan-600/60 hover:text-cyan-200"
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
          No boards enabled — add metrics via Customize.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {enabledBoards.map((b) => (
            <PlaylistBoard key={b.id} board={b} area={area} lens={lens} />
          ))}
        </div>
      )}
    </RegionDrilldown>
  );
}
