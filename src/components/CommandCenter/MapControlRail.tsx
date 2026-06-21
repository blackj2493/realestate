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
import { Navigation, GraduationCap, ShoppingCart, Palette, Lasso, Scale, Bookmark, History, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore, type RailModule } from "@/lib/stores/commandCenterStore";

type RailTile =
  | { kind: "drawer"; module: RailModule; label: string; description: string; icon: LucideIcon; dataActive?: boolean; badge?: number; tourId?: string }
  | { kind: "action"; id: string; label: string; description: string; icon: LucideIcon; active?: boolean; badge?: number; onClick: () => void; tourId?: string };

function Tile({
  icon: Icon,
  label,
  description,
  open,
  dataActive,
  badge,
  onClick,
  tourId,
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  open?: boolean;
  dataActive?: boolean;
  badge?: number;
  onClick: () => void;
  /** Discovery spotlight anchor — lets the Feature Guide point at this exact tile. */
  tourId?: string;
}) {
  return (
    <div className="group relative flex justify-center">
      <button
        type="button"
        onClick={onClick}
        data-tour={tourId}
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
  const amenityEnabled = useCommandCenterStore((s) => s.amenity.enabled);
  const selectedCount = useCommandCenterStore((s) => s.selectedIds.size);
  const colorMetricId = useCommandCenterStore((s) => s.colorMetricId);
  const isDrawing = useCommandCenterStore((s) => s.isDrawing);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const timelineActive = useCommandCenterStore((s) => s.timelineActive);
  const setTimelineActive = useCommandCenterStore((s) => s.setTimelineActive);
  const togglePalette = useCommandCenterStore((s) => s.togglePalette);

  // Group 1 — map layers: tools that shape or visualize the search on the map.
  const layerTiles: RailTile[] = [
    {
      kind: "drawer",
      module: "commute",
      label: "Commute",
      description: "Shade a drive/walk/cycle time zone and filter to homes inside it",
      icon: Navigation,
      dataActive: commuteEnabled,
      tourId: "rail-commute",
    },
    {
      kind: "drawer",
      module: "school",
      label: "Schools",
      description: "Shade school quality and filter to homes near a chosen school",
      icon: GraduationCap,
      dataActive: schoolEnabled,
      tourId: "rail-schools",
    },
    {
      kind: "drawer",
      module: "amenity",
      label: "Walkable",
      description: "Filter to homes within walking distance of a grocery store or recreation centre",
      icon: ShoppingCart,
      dataActive: amenityEnabled,
    },
    {
      kind: "drawer",
      module: "color",
      label: "Color By",
      description: "Color the map by price, yield, days-on-market & more",
      icon: Palette,
      dataActive: colorMetricId !== null,
      tourId: "rail-color",
    },
    {
      kind: "drawer",
      module: "draw",
      label: "Draw Area",
      description: "Lasso your own area to search inside it",
      icon: Lasso,
      dataActive: isDrawing || drawPolygon !== null,
      tourId: "rail-draw",
    },
  ];

  // Group 2 — tools: selection, saved presets, time scrub, and the ⌘K launcher.
  const toolTiles: RailTile[] = [
    {
      kind: "drawer",
      module: "compare",
      label: "Compare",
      description: "Collect homes to view side-by-side, isolate or share",
      icon: Scale,
      dataActive: selectedCount > 0,
      badge: selectedCount,
      tourId: "rail-compare",
    },
    {
      kind: "drawer",
      module: "lenses",
      label: "Saved Views",
      description: "Save this persona, filters & colors and reopen in one click",
      icon: Bookmark,
      tourId: "rail-saved",
    },
    {
      kind: "action",
      id: "time",
      label: "Timeline",
      description: "Scrub listings by days-on-market over time",
      icon: History,
      active: timelineActive,
      onClick: () => setTimelineActive(!timelineActive),
      tourId: "rail-timeline",
    },
    {
      kind: "action",
      id: "palette",
      label: "Quick Jump",
      description: "Jump to a city, persona, map mode or tool (⌘K)",
      icon: Zap,
      onClick: togglePalette,
      tourId: "command-palette",
    },
  ];

  const renderTile = (t: RailTile) =>
    t.kind === "drawer" ? (
      <Tile
        key={t.module}
        icon={t.icon}
        label={t.label}
        description={t.description}
        open={activeModule === t.module}
        dataActive={t.dataActive}
        badge={t.badge}
        tourId={t.tourId}
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
        tourId={t.tourId}
        onClick={t.onClick}
      />
    );

  return (
    <div
      data-tour="terminal-rail"
      className="absolute left-0 top-0 z-20 hidden h-full w-[68px] flex-col items-center gap-1 border-r border-slate-800 bg-slate-950/85 py-3 backdrop-blur-md md:flex"
    >
      <span className="text-[8px] font-semibold uppercase tracking-wider text-slate-600">Layers</span>
      {layerTiles.map(renderTile)}
      <div className="my-1.5 h-px w-7 bg-slate-800" />
      <span className="text-[8px] font-semibold uppercase tracking-wider text-slate-600">Tools</span>
      {toolTiles.map(renderTile)}
    </div>
  );
}
