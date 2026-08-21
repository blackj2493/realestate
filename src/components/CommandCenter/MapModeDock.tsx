/**
 * MapModeDock — the map render-mode switcher (Listings / Heatmap / 3D).
 *
 * Mode (how the map draws) is a different axis from Layers (what data overlays)
 * and Compare (selection), so it gets its own control instead of sharing the rail.
 * Drives store.mapMode, which AlphaMap reads.
 *
 * ONE control at every breakpoint: a single button parked directly under the
 * zoom +/- cluster (top-right), showing the CURRENT mode's icon — the
 * Google/Apple-Maps "layers" idiom. Clicking it fans out the three icon-only
 * options in place; picking one (or clicking the map) collapses it.
 *
 * This replaced a desktop-only labeled pill docked bottom-center. Two reasons it
 * went: it spent a permanent ~230px stripe of the map on a control used about
 * once a session, and it sat in the busiest part of the canvas — bottom-center is
 * where the pins the reader is hunting through tend to be. Collapsing it also
 * gathers the map chrome into ONE corner instead of two.
 *
 * Icon-only costs the labels, so every button carries both `title` (hover, mouse)
 * and `aria-label` (screen readers, all sizes), and the Command Palette still
 * offers all three modes by name.
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
    // top-[94px] parks this immediately below AlphaMap's zoom cluster
    // (right-2.5 top-2.5, two h-9 buttons + border ≈ 84px) on the same 10px
    // gutter. Both are z-20 siblings layered over the deck canvas.
    <div data-tour="terminal-map-modes" className="absolute right-2.5 top-[94px] z-20">
      {expanded && (
        // Invisible backdrop: any click outside the fan collapses it instead of
        // hitting the map. Rendered only while expanded, so the collapsed
        // control never blocks pin clicks beyond its own 36px square.
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
            title={`Map view: ${active.label}. Click to change.`}
            aria-label={`Map mode: ${active.label}. Change map mode`}
            aria-expanded={false}
            onClick={() => setExpanded(true)}
            className="flex h-9 w-9 items-center justify-center text-cyan-700 transition-colors hover:bg-muted active:bg-muted dark:text-cyan-300"
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
                title={s.label}
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
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
