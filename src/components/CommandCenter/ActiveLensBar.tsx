"use client";

/**
 * ActiveLensBar — phone-only (<md) IN-FLOW strip above the map: one chip per
 * active map mode/lens, each a direct one-tap exit.
 *
 * Why in-flow: the map's overlay banners collide on phones — the select-mode
 * toast rendered under the legend HUD (both absolute, top of map, z-10), and
 * lens tools (Schools/Commute/Walkable/Color/Draw/Zoning) had NO on-map exit at
 * all beyond the count badge on the Tools launcher — the "stuck in a mode"
 * complaint. A document-flow bar cannot be covered by map chrome, and the map
 * simply shrinks beneath it. Desktop keeps the rail's active dots + panels.
 *
 * Theme note: this bar sits OUTSIDE the map's `dark` instrument-deck scope, so
 * it uses theme tokens (works in the Daylight terminal too).
 */

import {
  Navigation,
  GraduationCap,
  ShoppingCart,
  Palette,
  Lasso,
  Scale,
  Landmark,
  X,
  Check,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { getMapMetric } from "@/lib/personas/mapMetrics";

export default function ActiveLensBar() {
  const isSelectMode = useCommandCenterStore((s) => s.isSelectMode);
  const setSelectMode = useCommandCenterStore((s) => s.setSelectMode);
  const selectedCount = useCommandCenterStore((s) => s.selectedIds.size);
  const clearSelection = useCommandCenterStore((s) => s.clearSelected);
  const commuteEnabled = useCommandCenterStore((s) => s.commute.enabled);
  const resetCommute = useCommandCenterStore((s) => s.resetCommute);
  const schoolEnabled = useCommandCenterStore((s) => s.school.enabled);
  const resetSchool = useCommandCenterStore((s) => s.resetSchool);
  const amenityEnabled = useCommandCenterStore((s) => s.amenity.enabled);
  const resetAmenity = useCommandCenterStore((s) => s.resetAmenity);
  const colorMetricId = useCommandCenterStore((s) => s.colorMetricId);
  const setColorMetricId = useCommandCenterStore((s) => s.setColorMetricId);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const setDrawPolygon = useCommandCenterStore((s) => s.setDrawPolygon);
  const showZoning = useCommandCenterStore((s) => s.showZoning);
  const setShowZoning = useCommandCenterStore((s) => s.setShowZoning);
  // In-progress draw: on phones the Tools sheet closes when a draw starts (the
  // full-screen sheet would cover the map), so this bar IS the draw UI.
  const isDrawing = useCommandCenterStore((s) => s.isDrawing);
  const drawPointCount = useCommandCenterStore((s) => s.drawPoints.length);
  const undoDrawPoint = useCommandCenterStore((s) => s.undoDrawPoint);
  const finishDrawing = useCommandCenterStore((s) => s.finishDrawing);
  const clearDraw = useCommandCenterStore((s) => s.clearDraw);

  type Chip = {
    key: string;
    label: string;
    icon: typeof Scale;
    /** Select-mode gets a Done affordance instead of ✕. */
    done?: boolean;
    onExit: () => void;
    aria: string;
  };

  const chips: Chip[] = [];
  if (isSelectMode) {
    chips.push({
      key: "select",
      label: `Selecting${selectedCount > 0 ? ` · ${selectedCount}` : ""} — tap pins`,
      icon: Scale,
      done: true,
      onExit: () => setSelectMode(false),
      aria: "Done adding — exit selection mode",
    });
  } else if (selectedCount > 0) {
    chips.push({
      key: "selected",
      label: `Selected · ${selectedCount}`,
      icon: Scale,
      onExit: clearSelection,
      aria: `Clear the ${selectedCount} selected properties`,
    });
  }
  if (commuteEnabled)
    chips.push({ key: "commute", label: "Commute", icon: Navigation, onExit: resetCommute, aria: "Turn off the commute filter" });
  if (schoolEnabled)
    chips.push({ key: "school", label: "Schools", icon: GraduationCap, onExit: resetSchool, aria: "Turn off the school lens" });
  if (amenityEnabled)
    chips.push({ key: "amenity", label: "Walkable", icon: ShoppingCart, onExit: resetAmenity, aria: "Turn off the walkability filter" });
  if (colorMetricId)
    chips.push({
      key: "color",
      label: `Color: ${getMapMetric(colorMetricId)?.label ?? "custom"}`,
      icon: Palette,
      onExit: () => setColorMetricId(null),
      aria: "Turn off Color By",
    });
  if (drawPolygon)
    chips.push({ key: "draw", label: "Drawn area", icon: Lasso, onExit: () => setDrawPolygon(null), aria: "Clear the drawn area" });
  if (showZoning)
    chips.push({ key: "zoning", label: "Zoning", icon: Landmark, onExit: () => setShowZoning(false), aria: "Turn off the zoning overlay" });

  if (chips.length === 0 && !isDrawing) return null;

  return (
    <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card px-3 py-1.5 md:hidden">
      {isDrawing && (
        <>
          <span className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border border-dashed border-cyan-500/60 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-700 dark:text-cyan-200">
            <Lasso className="h-3.5 w-3.5" />
            {drawPointCount < 3 ? `Tap the map · ${drawPointCount}/3` : `${drawPointCount} points`}
          </span>
          <button
            type="button"
            onClick={undoDrawPoint}
            disabled={drawPointCount === 0}
            aria-label="Undo the last point"
            className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-semibold text-foreground active:bg-muted disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
            Undo
          </button>
          <button
            type="button"
            onClick={finishDrawing}
            disabled={drawPointCount < 3}
            aria-label="Finish the shape and filter to it"
            className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border border-cyan-500 bg-cyan-500/15 px-3 text-xs font-bold text-cyan-700 disabled:opacity-40 dark:text-cyan-200"
          >
            <Check className="h-3.5 w-3.5" />
            Finish
          </button>
          <button
            type="button"
            onClick={clearDraw}
            aria-label="Cancel drawing"
            className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-semibold text-muted-foreground active:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </>
      )}
      {chips.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.key}
            type="button"
            onClick={c.onExit}
            aria-label={c.aria}
            className={cn(
              "flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
              c.done
                ? "border-cyan-500 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200"
                : "border-border bg-background text-foreground active:bg-muted"
            )}
          >
            <Icon className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
            {c.label}
            {c.done ? (
              <span className="ml-0.5 flex items-center gap-1 border-l border-cyan-500/40 pl-2 font-bold">
                <Check className="h-3.5 w-3.5" />
                Done
              </span>
            ) : (
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        );
      })}
    </div>
  );
}
