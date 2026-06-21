/**
 * MapModeDock — bottom-center segmented control for the map render mode.
 *
 * Mode (how the map draws) is a different axis from Layers (what data overlays)
 * and Compare (selection), so it gets its own dock instead of sharing the rail.
 * Drives store.mapMode, which AlphaMap reads. The "3d" segment is registered in
 * Phase 3 once the extruded view exists.
 */

"use client";

import React from "react";
import { MapPin, Layers, Box, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import type { MapMode } from "@/lib/personas/personaConfig";

const SEGMENTS: { id: MapMode; label: string; icon: LucideIcon }[] = [
  { id: "listings", label: "Listings", icon: MapPin },
  { id: "heatmap", label: "Heatmap", icon: Layers },
  { id: "3d", label: "3D", icon: Box },
];

const ENABLED: MapMode[] = ["listings", "heatmap", "3d"];

export default function MapModeDock() {
  const mapMode = useCommandCenterStore((s) => s.mapMode);
  const setMapMode = useCommandCenterStore((s) => s.setMapMode);

  // Desktop: bottom-center dock. Mobile: relocated to the top-left corner so the
  // crowded bottom edge (legend HUD + the fixed List/Map toggle) no longer stacks
  // three controls on top of each other on a ~360px canvas. z-20 keeps it above
  // the MapStatusHUD (z-10) it now sits just above at top-left.
  return (
    <div data-tour="terminal-map-modes" className="absolute left-2 top-3 z-20 md:bottom-4 md:left-1/2 md:top-auto md:-translate-x-1/2">
      <div className="flex overflow-hidden border border-slate-700 bg-slate-900/90 backdrop-blur-md">
        {SEGMENTS.filter((s) => ENABLED.includes(s.id)).map((s) => {
          const active = mapMode === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setMapMode(s.id)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors md:px-4 md:py-2 md:text-sm",
                active ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-100"
              )}
            >
              <Icon className="h-4 w-4" />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
