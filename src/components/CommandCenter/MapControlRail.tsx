/**
 * MapControlRail — the Instrument Deck's permanent left-edge launcher.
 *
 * A thin always-visible icon rail that *is* the map's feature menu (solving the
 * old discoverability gap). Each tile is one module: clicking a "drawer" tile
 * opens its panel (one at a time, via the store's activeModule); "action" tiles
 * toggle a mode in place. Tiles surface their own state — open (cyan accent),
 * data-active (cyan dot), or count badge — so a glance tells you what's shaping
 * the map. New modules are added here as later phases land.
 */

"use client";

import React from "react";
import { Layers, CheckSquare, Palette, PenTool, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore, type RailModule } from "@/lib/stores/commandCenterStore";

type RailTile =
  | { kind: "drawer"; module: RailModule; label: string; icon: LucideIcon; dataActive?: boolean }
  | { kind: "action"; id: string; label: string; icon: LucideIcon; active?: boolean; badge?: number; onClick: () => void };

function Tile({
  icon: Icon,
  label,
  open,
  dataActive,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
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
        aria-label={label}
        aria-pressed={open}
        className={cn(
          "relative flex h-11 w-11 items-center justify-center border transition-all",
          open
            ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
            : "border-transparent text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
        )}
      >
        {/* Open-state accent bar */}
        {open && <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 bg-cyan-400" />}
        <Icon className="h-[18px] w-[18px]" />
        {/* Data-active dot */}
        {dataActive && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
        )}
        {/* Count badge */}
        {badge != null && badge > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-bold leading-none text-slate-950">
            {badge}
          </span>
        )}
      </button>
      {/* Tooltip */}
      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-slate-200 opacity-0 transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}

export default function MapControlRail() {
  const activeModule = useCommandCenterStore((s) => s.activeModule);
  const toggleModule = useCommandCenterStore((s) => s.toggleModule);
  const commuteEnabled = useCommandCenterStore((s) => s.commute.enabled);
  const schoolEnabled = useCommandCenterStore((s) => s.school.enabled);
  const isSelectMode = useCommandCenterStore((s) => s.isSelectMode);
  const setSelectMode = useCommandCenterStore((s) => s.setSelectMode);
  const selectedCount = useCommandCenterStore((s) => s.selectedIds.size);
  const colorMetricId = useCommandCenterStore((s) => s.colorMetricId);
  const isDrawing = useCommandCenterStore((s) => s.isDrawing);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);

  const tiles: RailTile[] = [
    {
      kind: "drawer",
      module: "layers",
      label: "Data Layers",
      icon: Layers,
      dataActive: commuteEnabled || schoolEnabled,
    },
    {
      kind: "drawer",
      module: "color",
      label: "Color By",
      icon: Palette,
      dataActive: colorMetricId !== null,
    },
    {
      kind: "drawer",
      module: "draw",
      label: "Draw Area",
      icon: PenTool,
      dataActive: isDrawing || drawPolygon !== null,
    },
    {
      kind: "action",
      id: "select",
      label: "Compare",
      icon: CheckSquare,
      active: isSelectMode,
      badge: selectedCount,
      onClick: () => setSelectMode(!isSelectMode),
    },
  ];

  return (
    <div className="absolute left-0 top-0 z-20 flex h-full w-14 flex-col items-center gap-1 border-r border-slate-800 bg-slate-950/85 py-3 backdrop-blur-md">
      {tiles.map((t) =>
        t.kind === "drawer" ? (
          <Tile
            key={t.module}
            icon={t.icon}
            label={t.label}
            open={activeModule === t.module}
            dataActive={t.dataActive}
            onClick={() => toggleModule(t.module)}
          />
        ) : (
          <Tile
            key={t.id}
            icon={t.icon}
            label={t.label}
            open={t.active}
            badge={t.badge}
            onClick={t.onClick}
          />
        )
      )}
    </div>
  );
}
