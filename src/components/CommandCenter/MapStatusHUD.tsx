/**
 * MapStatusHUD — bottom-left status strip merging the color legend with the
 * in-view count. Unlike HouseSigma, the map *tells you what its colors mean*:
 * the active metric's low→high ramp is labelled, and the count makes the 100-cap
 * progressive-reveal legible. Clickable legend bands (filter-to-band) land in
 * Phase 2; this phase establishes the surface.
 */

"use client";

import React from "react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { ALPHA_GLOW_RANGE, type MapColorConfig } from "@/lib/personas/personaConfig";

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

export default function MapStatusHUD({
  count,
  total,
  colorConfig,
  commuteActive,
}: {
  count: number;
  total: number;
  colorConfig: MapColorConfig;
  commuteActive: boolean;
}) {
  const mapMode = useCommandCenterStore((s) => s.mapMode);

  // Heatmap columns use the alpha-glow ramp; pins keep the persona/metric hue.
  const range = mapMode === "heatmap" ? ALPHA_GLOW_RANGE : colorConfig.range;
  const capped = total > count;

  return (
    <div className="absolute bottom-4 left-16 z-10 border border-slate-700 bg-slate-900/90 px-3 py-2 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Color</span>
        <span className="text-[11px] text-slate-400">{colorConfig.legendLow}</span>
        <div
          className="h-1.5 w-24 rounded-full"
          style={{ background: `linear-gradient(to right, ${rgb(range[0])}, ${rgb(range[range.length - 1])})` }}
        />
        <span className="text-[11px] text-slate-200">{colorConfig.legendHigh}</span>
      </div>
      <div className="mt-1.5 font-mono text-xs text-slate-300">
        <span className="font-semibold text-cyan-400">{count}</span>
        {capped ? ` of ${total.toLocaleString()}` : ""} in {commuteActive ? "commute zone" : "view"}
        {capped && <span className="ml-1.5 text-slate-500">· zoom in to see all</span>}
      </div>
    </div>
  );
}
