/**
 * MapControlRail — the Instrument Deck's permanent left-edge launcher.
 *
 * A thin always-visible rail that *is* the map's feature menu (solving the old
 * discoverability gap). Each tile is one module: clicking a "drawer" tile opens
 * its panel (one at a time, via the store's activeModule); "action" tiles toggle
 * a mode in place. Every tile carries an always-visible text label (so the tool
 * is legible at rest, not just on hover) plus a hover tooltip describing what it
 * does. Tiles also surface their own state — open (cyan accent), data-active
 * (cyan dot), or count badge — so a glance tells you what's shaping the map.
 */

"use client";

import React from "react";
import { Layers, Palette, PenTool, GitCompareArrows, Bookmark, Clock, Command, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore, type RailModule } from "@/lib/stores/commandCenterStore";

type RailTile =
  | { kind: "drawer"; module: RailModule; label: string; description: string; icon: LucideIcon; dataActive?: boolean; badge?: number }
  | { kind: "action"; id: string; label: string; description: string; icon: LucideIcon; active?: boolean; badge?: number; onClick: () => void };

function Tile({
  icon: Icon,
  label,
  description,
  open,
  dataActive,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  open?: boolean;
  dataActive?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <div className="group relative flex justify-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={description ? `${label}: ${description}` : label}
        aria-pressed={open}
        className={cn(
          "relative flex w-[60px] flex-col items-center gap-1 border py-1.5 transition-all",
          open
            ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
            : "border-transparent text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
        )}
      >
        {/* Open-state accent bar */}
        {open && <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 bg-cyan-400" />}
        {/* Icon (anchors the state dot / count badge so they don't collide with the label) */}
        <span className="relative">
          <Icon className="h-[18px] w-[18px]" />
          {/* Data-active dot (suppressed when a count badge already signals state) */}
          {dataActive && !(badge && badge > 0) && (
            <span className="absolute -right-1.5 -top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
          )}
          {/* Count badge */}
          {badge != null && badge > 0 && (
            <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-bold leading-none text-slate-950">
              {badge}
            </span>
          )}
        </span>
        {/* Always-visible label */}
        <span className="text-center text-[9px] font-medium uppercase leading-tight tracking-wide">{label}</span>
      </button>
      {/* Description tooltip — explains what the tool does on hover */}
      {description && (
        <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 flex max-w-[200px] -translate-y-1/2 flex-col gap-0.5 whitespace-normal border border-slate-700 bg-slate-900 px-2.5 py-1.5 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-100">{label}</span>
          <span className="text-[11px] leading-snug text-slate-400">{description}</span>
        </span>
      )}
    </div>
  );
}

export default function MapControlRail() {
  const activeModule = useCommandCenterStore((s) => s.activeModule);
  const toggleModule = useCommandCenterStore((s) => s.toggleModule);
  const commuteEnabled = useCommandCenterStore((s) => s.commute.enabled);
  const schoolEnabled = useCommandCenterStore((s) => s.school.enabled);
  const selectedCount = useCommandCenterStore((s) => s.selectedIds.size);
  const colorMetricId = useCommandCenterStore((s) => s.colorMetricId);
  const isDrawing = useCommandCenterStore((s) => s.isDrawing);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const timelineActive = useCommandCenterStore((s) => s.timelineActive);
  const setTimelineActive = useCommandCenterStore((s) => s.setTimelineActive);
  const togglePalette = useCommandCenterStore((s) => s.togglePalette);

  const tiles: RailTile[] = [
    {
      kind: "drawer",
      module: "layers",
      label: "Overlays",
      description: "Show schools, commute times & more on the map",
      icon: Layers,
      dataActive: commuteEnabled || schoolEnabled,
    },
    {
      kind: "drawer",
      module: "color",
      label: "Heatmap",
      description: "Color the map by yield, days-on-market or price",
      icon: Palette,
      dataActive: colorMetricId !== null,
    },
    {
      kind: "drawer",
      module: "draw",
      label: "Draw area",
      description: "Draw your own area to search inside it",
      icon: PenTool,
      dataActive: isDrawing || drawPolygon !== null,
    },
    {
      kind: "drawer",
      module: "compare",
      label: "Compare",
      description: "Put the homes you pick side-by-side",
      icon: GitCompareArrows,
      dataActive: selectedCount > 0,
      badge: selectedCount,
    },
    {
      kind: "drawer",
      module: "lenses",
      label: "Saved views",
      description: "Save this setup & reopen it in one click",
      icon: Bookmark,
    },
    {
      kind: "action",
      id: "time",
      label: "Timeline",
      description: "Play listings forward & back through time",
      icon: Clock,
      active: timelineActive,
      onClick: () => setTimelineActive(!timelineActive),
    },
    {
      kind: "action",
      id: "palette",
      label: "Search",
      description: "Jump to a city, tool or view (⌘K)",
      icon: Command,
      onClick: togglePalette,
    },
  ];

  return (
    <div className="absolute left-0 top-0 z-20 flex h-full w-[68px] flex-col items-center gap-1 border-r border-slate-800 bg-slate-950/85 py-3 backdrop-blur-md">
      {tiles.map((t) =>
        t.kind === "drawer" ? (
          <Tile
            key={t.module}
            icon={t.icon}
            label={t.label}
            description={t.description}
            open={activeModule === t.module}
            dataActive={t.dataActive}
            badge={t.badge}
            onClick={() => toggleModule(t.module)}
          />
        ) : (
          <Tile
            key={t.id}
            icon={t.icon}
            label={t.label}
            description={t.description}
            open={t.active}
            badge={t.badge}
            onClick={t.onClick}
          />
        )
      )}
    </div>
  );
}
