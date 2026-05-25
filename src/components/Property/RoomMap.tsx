"use client";

/**
 * RoomMap — the Proportional Room Map.
 *
 * Draws every room as a rectangle at its TRUE dimensions on a single shared scale,
 * grouped by floor, so size differences are instantly readable (a 6.95×5.24 kitchen
 * visibly dwarfs a 3.46×3.26 bedroom). This is the differentiator over the plain
 * room table HouseSigma/realtor.ca show.
 *
 * Honesty: we have dimensions but NOT room positions/adjacency, so the layout is a
 * schematic packing — relative sizes are accurate, the arrangement is not an
 * architectural floor plan. Captioned as such.
 *
 * Compliance (CLAUDE.md §4): pure deterministic SVG from numeric dimensions — no LLM.
 *
 * All geometry is computed in METRES; the SVG viewBox is in metres and scales to the
 * container width, so packing is identical at every screen size.
 */

import React, { useMemo, useState } from "react";
import { Ruler, LayoutGrid, List as ListIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  processRooms,
  groupRoomsByLevel,
  getUniqueLevels,
  getLevelColor,
  formatArea,
  formatDimensions,
  type RoomData,
  type ProcessedRoom,
} from "@/lib/room-utils";

// ── Layout constants (metres) ────────────────────────────────────────────────
const GAP = 0.4; // gap between rooms
const PAD = 0.4; // outer padding
const ROW_BUDGET = 13; // target row width before wrapping
const LABEL_H = 1.5; // floor-label band height
const LEVEL_GAP = 1.0; // gap between floors
const FONT_NAME = 0.46;
const FONT_DIM = 0.4;
const FONT_AREA = 0.38;
const FONT_LEVEL = 0.78;
const STROKE = 0.06;

// Display floors top-to-bottom like a building cross-section (top floor first).
const LEVEL_ORDER: Record<string, number> = {
  Third: 0,
  Upper: 1,
  Second: 2,
  Main: 3,
  Ground: 4,
  Lower: 5,
  Basement: 6,
};

type Unit = "sqm" | "sqft";
type Mode = "map" | "list";

interface PlacedRoom extends ProcessedRoom {
  x: number;
  y: number;
  w: number; // landscape: max(length,width)
  h: number; // min(length,width)
}

interface PlacedLevel {
  level: string;
  color: string;
  labelY: number;
  rooms: PlacedRoom[];
}

function normalize(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value.join(", ") : value;
}

function rawDims(r: RoomData): string {
  if (r.RoomDimensions) return String(r.RoomDimensions);
  if (r.RoomLength && r.RoomWidth) return `${r.RoomLength} × ${r.RoomWidth} m`;
  return "—";
}

function orderedLevels(levels: string[]): string[] {
  return [...levels].sort((a, b) => {
    const ra = LEVEL_ORDER[a] ?? 99;
    const rb = LEVEL_ORDER[b] ?? 99;
    return ra === rb ? a.localeCompare(b) : ra - rb;
  });
}

/** Shelf/row bin-packing in metre space across floors on one shared scale. */
function layout(processed: ProcessedRoom[]): { levels: PlacedLevel[]; width: number; height: number } {
  const grouped = groupRoomsByLevel(processed);
  const levels = orderedLevels(getUniqueLevels(processed));

  // Budget must fit the single widest room.
  const maxRoomW = processed.reduce((m, r) => Math.max(m, Math.max(r.length, r.width)), 0);
  const budget = Math.max(maxRoomW, ROW_BUDGET);

  const placedLevels: PlacedLevel[] = [];
  let cursorY = PAD;
  let contentRight = 0;

  for (const level of levels) {
    const rooms = (grouped.get(level) ?? [])
      .slice()
      .sort((a, b) => b.areaMeters - a.areaMeters);

    const labelY = cursorY;
    const blockTop = cursorY + LABEL_H;

    let rowX = 0;
    let rowY = 0;
    let rowH = 0;
    const placed: PlacedRoom[] = [];

    for (const r of rooms) {
      const w = Math.max(r.length, r.width);
      const h = Math.min(r.length, r.width);
      if (rowX > 0 && rowX + GAP + w > budget) {
        rowX = 0;
        rowY += rowH + GAP;
        rowH = 0;
      }
      placed.push({ ...r, x: PAD + rowX, y: blockTop + rowY, w, h });
      contentRight = Math.max(contentRight, PAD + rowX + w);
      rowX += w + GAP;
      rowH = Math.max(rowH, h);
    }

    const blockH = rowY + rowH;
    placedLevels.push({ level, color: getLevelColor(level), labelY, rooms: placed });
    cursorY = blockTop + blockH + LEVEL_GAP;
  }

  const width = Math.max(contentRight + PAD, budget + 2 * PAD);
  const height = Math.max(cursorY - LEVEL_GAP + PAD, PAD * 2);
  return { levels: placedLevels, width, height };
}

function truncate(s: string, w: number, fontW = 0.27): string {
  const max = Math.max(2, Math.floor((w - 0.4) / fontW));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export default function RoomMap({
  rooms,
  className,
}: {
  rooms: RoomData[];
  className?: string;
}) {
  const raw = Array.isArray(rooms) ? rooms : [];
  const processed = useMemo(() => processRooms(raw), [raw]);
  const hasScaled = processed.length > 0;

  const [unit, setUnit] = useState<Unit>("sqm");
  const [mode, setMode] = useState<Mode>(hasScaled ? "map" : "list");
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  const [active, setActive] = useState<PlacedRoom | null>(null);

  const filtered = useMemo(
    () => (levelFilter ? processed.filter((r) => r.level === levelFilter) : processed),
    [processed, levelFilter]
  );
  const { levels, width, height } = useMemo(() => layout(filtered), [filtered]);
  const filterLevels = useMemo(() => orderedLevels(getUniqueLevels(processed)), [processed]);

  // List view rows include EVERY room (even dimensionless ones the map drops).
  const listRooms = useMemo(
    () =>
      raw.filter((r) => {
        if (!levelFilter) return true;
        return normalize(r.RoomLevel) === levelFilter;
      }),
    [raw, levelFilter]
  );

  if (raw.length === 0) {
    return (
      <div className={cn("bg-slate-900/50 rounded-lg border border-slate-800 p-4", className)}>
        <Header
          unit={unit}
          setUnit={setUnit}
          mode={mode}
          setMode={setMode}
          showMapToggle={false}
        />
        <p className="py-3 text-center text-xs text-slate-500">
          Room details unavailable for this listing.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("bg-slate-900/50 rounded-lg border border-slate-800 p-4", className)}>
      <Header
        unit={unit}
        setUnit={setUnit}
        mode={mode}
        setMode={setMode}
        showMapToggle={hasScaled}
      />

      {/* Level filter pills */}
      {filterLevels.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterPill active={levelFilter === null} onClick={() => setLevelFilter(null)}>
            All
          </FilterPill>
          {filterLevels.map((lvl) => (
            <FilterPill
              key={lvl}
              active={levelFilter === lvl}
              color={getLevelColor(lvl)}
              onClick={() => setLevelFilter((cur) => (cur === lvl ? null : lvl))}
            >
              {lvl}
            </FilterPill>
          ))}
        </div>
      )}

      {mode === "map" && hasScaled ? (
        <>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            className="block"
            role="img"
            aria-label="Scaled map of room dimensions grouped by floor"
            style={{ maxHeight: "70vh" }}
          >
            <defs>
              <pattern
                id="rm-comb"
                width="0.7"
                height="0.7"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="0.7" height="0.7" fill="transparent" />
                <line x1="0" y1="0" x2="0" y2="0.7" stroke="#e2e8f0" strokeWidth="0.07" opacity="0.18" />
              </pattern>
            </defs>

            {levels.map((lvl) => (
              <g key={lvl.level}>
                {/* Floor label band */}
                <text
                  x={PAD}
                  y={lvl.labelY + FONT_LEVEL}
                  fontSize={FONT_LEVEL}
                  className="font-semibold uppercase"
                  fill={lvl.color}
                  style={{ letterSpacing: "0.04em" }}
                >
                  {lvl.level}
                </text>

                {lvl.rooms.map((r) => {
                  const showName = r.w > 2.2 && r.h > 1.2;
                  const showDim = r.w > 2.8 && r.h > 2.0;
                  const showArea = r.w > 2.8 && r.h > 2.9;
                  const isActive = active?.id === r.id;
                  return (
                    <g
                      key={r.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`${r.name}, ${lvl.level}, ${formatDimensions(r.length, r.width)}, ${formatArea(r.areaMeters, unit)}`}
                      onMouseEnter={() => setActive(r)}
                      onMouseLeave={() => setActive((cur) => (cur?.id === r.id ? null : cur))}
                      onFocus={() => setActive(r)}
                      onBlur={() => setActive((cur) => (cur?.id === r.id ? null : cur))}
                      style={{ cursor: "pointer", outline: "none" }}
                    >
                      <title>
                        {r.name} · {lvl.level} · {formatDimensions(r.length, r.width)} ·{" "}
                        {formatArea(r.areaMeters, unit)}
                        {r.isLikelyCombinedSpace ? " · likely combined space" : ""}
                      </title>
                      <rect
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={r.h}
                        rx={0.12}
                        fill={lvl.color}
                        fillOpacity={isActive ? 0.34 : 0.18}
                        stroke={lvl.color}
                        strokeWidth={isActive ? STROKE * 2 : STROKE}
                      />
                      {r.isLikelyCombinedSpace && (
                        <rect
                          x={r.x}
                          y={r.y}
                          width={r.w}
                          height={r.h}
                          rx={0.12}
                          fill="url(#rm-comb)"
                          pointerEvents="none"
                        />
                      )}
                      {showName && (
                        <text
                          x={r.x + 0.25}
                          y={r.y + 0.25 + FONT_NAME}
                          fontSize={FONT_NAME}
                          fill="#e2e8f0"
                          className="font-medium"
                          pointerEvents="none"
                        >
                          {truncate(r.name, r.w)}
                        </text>
                      )}
                      {showDim && (
                        <text
                          x={r.x + 0.25}
                          y={r.y + 0.25 + FONT_NAME + 0.15 + FONT_DIM}
                          fontSize={FONT_DIM}
                          fill="#94a3b8"
                          fontFamily="monospace"
                          pointerEvents="none"
                        >
                          {r.length.toFixed(2)}×{r.width.toFixed(2)}m
                        </text>
                      )}
                      {showArea && (
                        <text
                          x={r.x + 0.25}
                          y={r.y + 0.25 + FONT_NAME + 0.15 + FONT_DIM + 0.12 + FONT_AREA}
                          fontSize={FONT_AREA}
                          fill="#64748b"
                          fontFamily="monospace"
                          pointerEvents="none"
                        >
                          {formatArea(r.areaMeters, unit)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>

          {/* Hover/focus detail strip */}
          <div className="mt-2 h-5 text-xs">
            {active ? (
              <span className="flex flex-wrap items-center gap-x-2 text-slate-300">
                <span className="font-semibold text-slate-100">{active.name}</span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-400">{active.level}</span>
                <span className="text-slate-500">·</span>
                <span className="font-mono text-slate-300">
                  {formatDimensions(active.length, active.width)}
                </span>
                <span className="text-slate-500">·</span>
                <span className="font-mono text-emerald-400">
                  {formatArea(active.areaMeters, unit)}
                </span>
                {active.isLikelyCombinedSpace && (
                  <span className="text-amber-400/80">· likely combined space</span>
                )}
              </span>
            ) : (
              <span className="text-slate-600">Hover or tap a room for details</span>
            )}
          </div>
        </>
      ) : (
        // ── List view (the ledger) — shows every room, even dimensionless ones ──
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="py-2 text-left">Room</th>
              <th className="py-2 text-left">Level</th>
              <th className="py-2 text-right">Dimensions</th>
              <th className="py-2 text-right">Area</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {listRooms.map((r, i) => {
              const hasDims = !!(r.RoomLength && r.RoomWidth);
              return (
                <tr key={i} className="hover:bg-slate-900/30">
                  <td className="py-2 text-slate-200">{normalize(r.RoomType) || "—"}</td>
                  <td className="py-2 text-slate-400">{normalize(r.RoomLevel) || "—"}</td>
                  <td className="py-2 text-right font-mono text-slate-300">{rawDims(r)}</td>
                  <td className="py-2 text-right font-mono text-slate-400">
                    {hasDims ? formatArea(r.RoomLength! * r.RoomWidth!, unit) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
        Drawn to scale from listed room dimensions. Relative sizes are accurate; the
        layout is schematic — not an architectural floor plan.
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({
  unit,
  setUnit,
  mode,
  setMode,
  showMapToggle,
}: {
  unit: Unit;
  setUnit: (u: Unit) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  showMapToggle: boolean;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200">
        <Ruler className="h-4 w-4 text-emerald-400" />
        Room Dimensions
      </h3>
      <div className="flex items-center gap-1.5">
        {/* unit toggle */}
        <div className="flex overflow-hidden rounded border border-slate-700">
          {(["sqm", "sqft"] as Unit[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={cn(
                "px-2 py-0.5 text-[10px] font-medium transition-colors",
                unit === u ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"
              )}
            >
              {u === "sqm" ? "m²" : "ft²"}
            </button>
          ))}
        </div>
        {/* map/list toggle */}
        {showMapToggle && (
          <div className="flex overflow-hidden rounded border border-slate-700">
            <button
              type="button"
              onClick={() => setMode("map")}
              title="Map view"
              className={cn(
                "flex items-center px-1.5 py-1 transition-colors",
                mode === "map" ? "bg-slate-700 text-emerald-400" : "text-slate-400 hover:text-slate-200"
              )}
            >
              <LayoutGrid className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setMode("list")}
              title="List view"
              className={cn(
                "flex items-center px-1.5 py-1 transition-colors",
                mode === "list" ? "bg-slate-700 text-emerald-400" : "text-slate-400 hover:text-slate-200"
              )}
            >
              <ListIcon className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterPill({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "border-slate-500 bg-slate-700 text-slate-100"
          : "border-slate-800 text-slate-400 hover:text-slate-200"
      )}
    >
      {color && (
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      )}
      {children}
    </button>
  );
}
