"use client";

/**
 * RoomMap — per-floor room-size treemaps.
 *
 * One treemap PER FLOOR, stacked top-to-bottom (top floor first, basement last).
 * Within each floor, room tiles are sized proportionally to their area; across
 * floors a SHARED scale is used (each floor's height is proportional to that floor's
 * total area), so you can compare room sizes both within and between floors. This is
 * the differentiator over the plain room table HouseSigma / realtor.ca show.
 *
 * Honesty: areas are proportional and dimensions are as listed, but we have no room
 * positions/adjacency — this is NOT an architectural floor plan. Captioned as such.
 *
 * Compliance (CLAUDE.md §4): deterministic squarified-treemap layout from numeric
 * areas — no LLM.
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

// Treemap coordinate space (viewBox units; each floor SVG scales to container width).
const VB_W = 1000;
const H_TOTAL = 540; // total viewBox height shared across all floors (∝ area)
const MIN_FLOOR_VBH = 96; // floor band floor so a tiny floor stays usable
const OUTER_PAD = 3;
const ROOM_GAP = 3; // inset between room tiles

type Unit = "sqm" | "sqft";
type Mode = "map" | "list";

interface TItem {
  id: string;
  value: number;
  room?: ProcessedRoom;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Tile extends Rect {
  item: TItem;
}
interface RoomTile extends Rect {
  room: ProcessedRoom;
  color: string;
  floor: string;
}
interface FloorSection {
  floor: string;
  color: string;
  count: number;
  areaMeters: number;
  vbH: number;
  tiles: RoomTile[];
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

/**
 * Squarified treemap (Bruls et al.). Tiles `items` into the rect so areas are
 * proportional to `value` and tiles stay close to square. Deterministic.
 */
function squarify(items: TItem[], rect: Rect): Tile[] {
  const tiles: Tile[] = [];
  const total = items.reduce((s, it) => s + it.value, 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return tiles;

  const scale = (rect.w * rect.h) / total;
  const nodes = items
    .map((it) => ({ it, a: Math.max(it.value * scale, 1e-6) }))
    .sort((p, q) => q.a - p.a);

  let { x, y, w, h } = rect;

  const worst = (areas: number[], side: number): number => {
    const s = areas.reduce((acc, a) => acc + a, 0);
    const rmax = Math.max(...areas);
    const rmin = Math.min(...areas);
    const side2 = side * side;
    const s2 = s * s;
    return Math.max((side2 * rmax) / s2, s2 / (side2 * rmin));
  };

  const layoutRow = (row: { it: TItem; a: number }[]) => {
    const side = Math.min(w, h);
    const rowSum = row.reduce((s, e) => s + e.a, 0);
    const thickness = rowSum / side;
    if (w >= h) {
      let cy = y;
      for (const e of row) {
        const th = e.a / thickness;
        tiles.push({ x, y: cy, w: thickness, h: th, item: e.it });
        cy += th;
      }
      x += thickness;
      w -= thickness;
    } else {
      let cx = x;
      for (const e of row) {
        const tw = e.a / thickness;
        tiles.push({ x: cx, y, w: tw, h: thickness, item: e.it });
        cx += tw;
      }
      y += thickness;
      h -= thickness;
    }
  };

  let row: { it: TItem; a: number }[] = [];
  let idx = 0;
  while (idx < nodes.length) {
    const side = Math.min(w, h);
    const cand = nodes[idx];
    const rowAreas = row.map((r) => r.a);
    if (row.length === 0 || worst([...rowAreas, cand.a], side) <= worst(rowAreas, side)) {
      row.push(cand);
      idx++;
    } else {
      layoutRow(row);
      row = [];
    }
  }
  if (row.length) layoutRow(row);

  return tiles;
}

function inset(r: Rect, gap: number): Rect {
  const g = Math.max(0, Math.min(gap, r.w / 2 - 0.5, r.h / 2 - 0.5));
  return { x: r.x + g, y: r.y + g, w: r.w - 2 * g, h: r.h - 2 * g };
}

/** One treemap section per floor; floor band height ∝ floor area (shared scale). */
function buildFloorSections(
  rooms: ProcessedRoom[],
  levelFilter: string | null
): FloorSection[] {
  const visible = levelFilter ? rooms.filter((r) => r.level === levelFilter) : rooms;
  if (visible.length === 0) return [];

  const grouped = groupRoomsByLevel(visible);
  const levels = orderedLevels(getUniqueLevels(visible));
  const totalArea = visible.reduce((s, r) => s + r.areaMeters, 0) || 1;

  const sections: FloorSection[] = [];
  for (const floor of levels) {
    const lvlRooms = (grouped.get(floor) ?? [])
      .slice()
      .sort((a, b) => b.areaMeters - a.areaMeters);
    if (lvlRooms.length === 0) continue;
    const floorArea = lvlRooms.reduce((s, r) => s + r.areaMeters, 0);
    const vbH = Math.max(MIN_FLOOR_VBH, (floorArea / totalArea) * H_TOTAL);
    const color = getLevelColor(floor);
    const rect: Rect = { x: OUTER_PAD, y: OUTER_PAD, w: VB_W - 2 * OUTER_PAD, h: vbH - 2 * OUTER_PAD };
    const items: TItem[] = lvlRooms.map((r) => ({ id: r.id, value: r.areaMeters, room: r }));
    const tiles: RoomTile[] = [];
    for (const t of squarify(items, rect)) {
      if (!t.item.room) continue;
      tiles.push({ ...inset(t, ROOM_GAP), room: t.item.room, color, floor });
    }
    sections.push({ floor, color, count: lvlRooms.length, areaMeters: floorArea, vbH, tiles });
  }
  return sections;
}

function truncate(s: string, tileW: number, fontSize: number): string {
  const max = Math.max(0, Math.floor((tileW - 10) / (fontSize * 0.56)));
  if (max <= 1) return "";
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

  const [unit, setUnit] = useState<Unit>("sqft");
  const [mode, setMode] = useState<Mode>(hasScaled ? "map" : "list");
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sections = useMemo(
    () => buildFloorSections(processed, levelFilter),
    [processed, levelFilter]
  );
  const filterLevels = useMemo(() => orderedLevels(getUniqueLevels(processed)), [processed]);
  const active = useMemo(() => {
    for (const s of sections) {
      const t = s.tiles.find((t) => t.room.id === activeId);
      if (t) return t;
    }
    return null;
  }, [sections, activeId]);

  // List view rows include EVERY room (even dimensionless ones the treemap drops).
  const listRooms = useMemo(
    () => raw.filter((r) => (levelFilter ? normalize(r.RoomLevel) === levelFilter : true)),
    [raw, levelFilter]
  );

  if (raw.length === 0) {
    return (
      <div className={cn("bg-card rounded-lg border border-border p-4", className)}>
        <Header unit={unit} setUnit={setUnit} mode={mode} setMode={setMode} showToggle={false} />
        <p className="py-2 text-center text-xs text-muted-foreground">
          Room details unavailable for this listing.
        </p>
      </div>
    );
  }

  return (
    <div data-tour="listing-room-map" className={cn("bg-card rounded-lg border border-border p-4", className)}>
      <Header unit={unit} setUnit={setUnit} mode={mode} setMode={setMode} showToggle={hasScaled} />

      {/* Level filter pills (double as the floor legend) */}
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
          <div className="space-y-4">
            {sections.map((sec) => (
              <section key={sec.floor}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: sec.color }}
                    aria-hidden
                  />
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    {sec.floor}
                  </h4>
                  <span className="text-[10px] text-muted-foreground">
                    {sec.count} {sec.count === 1 ? "room" : "rooms"} · {formatArea(sec.areaMeters, unit)}
                  </span>
                </div>
                <svg
                  viewBox={`0 0 ${VB_W} ${sec.vbH}`}
                  width={VB_W}
                  height={sec.vbH}
                  className="block h-auto w-full"
                  role="img"
                  aria-label={`${sec.floor} room sizes, to scale`}
                >
                  {sec.tiles.map((t) => {
                    const isActive = active?.room.id === t.room.id;
                    const showName = t.w > 64 && t.h > 30;
                    const showArea = t.w > 64 && t.h > 50;
                    const showDim = t.w > 96 && t.h > 70;
                    return (
                      <g
                        key={t.room.id}
                        tabIndex={0}
                        role="button"
                        aria-label={`${t.room.name}, ${t.floor}, ${formatDimensions(
                          t.room.length,
                          t.room.width
                        )}, ${formatArea(t.room.areaMeters, unit)}`}
                        onMouseEnter={() => setActiveId(t.room.id)}
                        onMouseLeave={() => setActiveId((c) => (c === t.room.id ? null : c))}
                        onFocus={() => setActiveId(t.room.id)}
                        onBlur={() => setActiveId((c) => (c === t.room.id ? null : c))}
                        style={{ cursor: "pointer", outline: "none" }}
                      >
                        {/* Single string child — React requires <title> children to
                            collapse to one text node, else SSR/CSR hydration mismatches. */}
                        <title>
                          {`${t.room.name} · ${t.floor} · ${formatDimensions(t.room.length, t.room.width)} · ${formatArea(t.room.areaMeters, unit)}${t.room.isLikelyCombinedSpace ? " · likely combined space" : ""}`}
                        </title>
                        <rect
                          x={t.x}
                          y={t.y}
                          width={t.w}
                          height={t.h}
                          rx={4}
                          fill={t.color}
                          // Stronger tint in light so tiles read as coloured (not washed)
                          // under dark labels; dark mode keeps its original opacities.
                          className={
                            isActive
                              ? "[fill-opacity:0.55] dark:[fill-opacity:0.5]"
                              : "[fill-opacity:0.38] dark:[fill-opacity:0.26]"
                          }
                          stroke={t.color}
                          strokeWidth={isActive ? 2.5 : 1.25}
                        />
                        {t.room.isLikelyCombinedSpace && (
                          <rect
                            x={t.x + 2}
                            y={t.y + 2}
                            width={Math.max(0, t.w - 4)}
                            height={Math.max(0, t.h - 4)}
                            rx={3}
                            fill="none"
                            stroke="#fbbf24"
                            strokeOpacity={0.6}
                            strokeWidth={1}
                            strokeDasharray="4 3"
                            pointerEvents="none"
                          />
                        )}
                        {showName && (
                          <text
                            x={t.x + 7}
                            y={t.y + 19}
                            fontSize={16}
                            className="font-semibold fill-slate-900 dark:fill-slate-100"
                            pointerEvents="none"
                          >
                            {truncate(t.room.name, t.w, 16)}
                          </text>
                        )}
                        {showArea && (
                          <text
                            x={t.x + 7}
                            y={t.y + 37}
                            fontSize={13}
                            fontFamily="monospace"
                            className="fill-slate-700 dark:fill-slate-300"
                            pointerEvents="none"
                          >
                            {formatArea(t.room.areaMeters, unit)}
                          </text>
                        )}
                        {showDim && (
                          <text
                            x={t.x + 7}
                            y={t.y + 53}
                            fontSize={12}
                            fontFamily="monospace"
                            className="fill-slate-600 dark:fill-slate-400"
                            pointerEvents="none"
                          >
                            {t.room.length.toFixed(2)} × {t.room.width.toFixed(2)} m
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </section>
            ))}
          </div>

          {/* Hover/focus detail strip */}
          <div className="mt-2 h-5 text-xs">
            {active ? (
              <span className="flex flex-wrap items-center gap-x-2 text-foreground">
                <span className="font-semibold text-foreground">{active.room.name}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{active.floor}</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono text-foreground">
                  {formatDimensions(active.room.length, active.room.width)}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">
                  {formatArea(active.room.areaMeters, unit)}
                </span>
                {active.room.isLikelyCombinedSpace && (
                  <span className="text-amber-600 dark:text-amber-400/80">· likely combined space</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">Hover or tap a room for details</span>
            )}
          </div>
        </>
      ) : (
        // ── List view (the ledger) — shows every room, even dimensionless ones ──
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-card/60 text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Room</th>
                <th className="px-3 py-2 text-left font-medium">Level</th>
                <th className="px-3 py-2 text-right font-medium">Dimensions</th>
                <th className="px-3 py-2 text-right font-medium">Area</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {listRooms.map((r, i) => {
                const hasDims = !!(r.RoomLength && r.RoomWidth);
                return (
                  <tr key={i} className="hover:bg-card/40">
                    <td className="px-3 py-2 text-foreground">{normalize(r.RoomType) || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{normalize(r.RoomLevel) || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">{rawDims(r)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {hasDims ? formatArea(r.RoomLength! * r.RoomWidth!, unit) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Each floor is shown separately; tile size = room area (shared scale across floors).
        Dimensions as listed — schematic, not an architectural floor plan.
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
  showToggle,
}: {
  unit: Unit;
  setUnit: (u: Unit) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  showToggle: boolean;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
        <Ruler className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        Room Dimensions
      </h3>
      <div className="flex items-center gap-1.5">
        {/* unit toggle */}
        <div className="flex overflow-hidden rounded border border-border">
          {(["sqm", "sqft"] as Unit[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={cn(
                "px-2 py-0.5 text-[10px] font-medium transition-colors",
                unit === u ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {u === "sqm" ? "m²" : "ft²"}
            </button>
          ))}
        </div>
        {/* treemap/list toggle */}
        {showToggle && (
          <div className="flex overflow-hidden rounded border border-border">
            <button
              type="button"
              onClick={() => setMode("map")}
              title="Treemap view"
              aria-label="Treemap view"
              className={cn(
                "flex items-center px-1.5 py-1 transition-colors",
                mode === "map" ? "bg-muted text-emerald-600 dark:text-emerald-400" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setMode("list")}
              title="List view"
              aria-label="List view"
              className={cn(
                "flex items-center px-1.5 py-1 transition-colors",
                mode === "list" ? "bg-muted text-emerald-600 dark:text-emerald-400" : "text-muted-foreground hover:text-foreground"
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
          ? "border-slate-500 bg-muted text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {color && (
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      )}
      {children}
    </button>
  );
}
