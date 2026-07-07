/**
 * MapModeDock — the map render-mode switcher (Listings / Heatmap / 3D).
 *
 * Mode (how the map draws) is a different axis from Layers (what data overlays)
 * and Compare (selection), so it gets its own dock instead of sharing the rail.
 * Drives store.mapMode, which AlphaMap reads.
 *
 * Desktop (md+): the original bottom-center segmented control, unchanged.
 * Phones: the labeled pill covered ~230px of a ~390px map, so it collapses to a
 * single button under the zoom cluster (top-right) showing the CURRENT mode's
 * icon — the Google/Apple-Maps "layers" idiom. Tapping fans out the three
 * icon-only options in place; picking one (or tapping the map) collapses it.
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
  const [expanded, setExpanded] = React.useState(false);

  const segments = SEGMENTS.filter((s) => ENABLED.includes(s.id));
  const active = segments.find((s) => s.id === mapMode) ?? segments[0];
  const ActiveIcon = active.icon;

  return (
    <>
      {/* Desktop: bottom-center segmented dock. NOTE: both variants carry the
          data-tour anchor; Spotlight picks the VISIBLE one (see Spotlight.tsx). */}
      <div
        data-tour="terminal-map-modes"
        className="absolute bottom-4 left-1/2 z-20 hidden -translate-x-1/2 md:block"
      >
        <div className="flex overflow-hidden border border-border bg-card/90 backdrop-blur-md">
          {segments.map((s) => {
            const isActive = mapMode === s.id;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setMapMode(s.id)}
                aria-pressed={isActive}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Phone: collapsed mode button directly below the zoom +/- cluster
          (AlphaMap: right-2.5 top-2.5, two h-9 buttons ≈ 86px tall). Expanded it
          becomes a vertical icon-only stack in the same spot. */}
      <div data-tour="terminal-map-modes" className="absolute right-2.5 top-[94px] z-20 md:hidden">
        {expanded && (
          // Invisible backdrop: any tap outside the fan collapses it instead of
          // hitting the map. Rendered only while expanded, so the collapsed
          // control never blocks pin taps beyond its own 36px square.
          <button
            type="button"
            aria-label="Close map mode picker"
            onClick={() => setExpanded(false)}
            className="fixed inset-0 cursor-default"
          />
        )}
        <div className="relative flex flex-col overflow-hidden rounded-md border border-border bg-card/90 shadow-lg backdrop-blur-sm">
          {!expanded ? (
            <button
              type="button"
              aria-label={`Map mode: ${active.label}. Change map mode`}
              aria-expanded={false}
              onClick={() => setExpanded(true)}
              className="flex h-9 w-9 items-center justify-center text-cyan-700 transition-colors dark:text-cyan-300"
            >
              <ActiveIcon className="h-4 w-4" />
            </button>
          ) : (
            segments.map((s, i) => {
              const isActive = mapMode === s.id;
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`${s.label} mode`}
                  aria-pressed={isActive}
                  onClick={() => {
                    setMapMode(s.id);
                    setExpanded(false);
                  }}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center transition-colors",
                    i > 0 && "border-t border-border",
                    isActive
                      ? "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300"
                      : "text-muted-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
