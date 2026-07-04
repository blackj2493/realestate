/**
 * MapStatusHUD — bottom-left status strip merging the color legend with the
 * in-view count. Unlike HouseSigma, the map *tells you what its colors mean*.
 *
 * When an explicit "Color By" metric is active, the legend becomes a row of
 * click-to-filter buckets: clicking a band narrows the map to that value range
 * (store.colorBand → Typesense filter). Otherwise it shows the persona/School
 * default ramp as a static gradient.
 */

"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { ALPHA_GLOW_RANGE, type MapColorConfig } from "@/lib/personas/personaConfig";
import { bandRange, type MapMetricDef } from "@/lib/personas/mapMetrics";

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

function CountLine({ count, total, commuteActive }: { count: number; total: number; commuteActive: boolean }) {
  const capped = total > count;
  return (
    <div className="mt-1.5 font-mono text-xs text-foreground">
      <span className="font-semibold text-cyan-600 dark:text-cyan-400">{count}</span>
      {capped ? ` of ${total.toLocaleString()}` : ""} in {commuteActive ? "commute zone" : "view"}
      {capped && <span className="ml-1.5 text-muted-foreground">· zoom in to see all</span>}
    </div>
  );
}

export default function MapStatusHUD({
  count,
  total,
  colorConfig,
  metricDef,
  commuteActive,
}: {
  count: number;
  total: number;
  colorConfig: MapColorConfig;
  metricDef: MapMetricDef | null;
  commuteActive: boolean;
}) {
  const mapMode = useCommandCenterStore((s) => s.mapMode);
  const colorBand = useCommandCenterStore((s) => s.colorBand);
  const setColorBand = useCommandCenterStore((s) => s.setColorBand);

  // ── Interactive legend (explicit field-backed metric) ──────────────────────
  if (metricDef && metricDef.field) {
    const fmtBand = (i: number) => {
      const { min, max } = bandRange(metricDef, i);
      return `${metricDef.format(min)}–${max === null ? "+" : metricDef.format(max)}`;
    };
    const activeIdx = colorBand?.metricId === metricDef.id ? colorBand.index : null;
    const onBand = (i: number) =>
      setColorBand(activeIdx === i ? null : { metricId: metricDef.id, index: i });

    return (
      <div className="absolute left-2 top-16 z-10 max-w-[80vw] border border-border bg-card/90 px-3 py-2 backdrop-blur-md md:bottom-4 md:left-16 md:top-auto md:max-w-[calc(100vw-1rem)]">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Color</span>
          <span className="text-[11px] font-medium text-foreground">{metricDef.label}</span>
          {activeIdx !== null && (
            <button
              type="button"
              onClick={() => setColorBand(null)}
              className="ml-1 flex items-center gap-1 text-[10px] text-cyan-700 dark:text-cyan-300 hover:text-cyan-100"
            >
              <X className="h-3 w-3" /> clear filter
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{metricDef.legendLow}</span>
          <div className="flex">
            {Array.from({ length: metricDef.bands }).map((_, i) => {
              const c = metricDef.range[Math.min(i, metricDef.range.length - 1)];
              const isActive = activeIdx === i;
              const dimmed = activeIdx !== null && !isActive;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onBand(i)}
                  title={fmtBand(i)}
                  aria-pressed={isActive}
                  className={cn(
                    "h-3 w-6 border-y border-r border-slate-950/40 transition-all first:rounded-l-sm first:border-l last:rounded-r-sm",
                    isActive && "outline outline-2 outline-cyan-300",
                    dimmed && "opacity-35 hover:opacity-70"
                  )}
                  style={{ backgroundColor: rgb(c) }}
                />
              );
            })}
          </div>
          <span className="text-[10px] text-foreground">{metricDef.legendHigh}</span>
        </div>
        {activeIdx !== null && (
          <div className="mt-1 font-mono text-[10px] text-cyan-700 dark:text-cyan-300">Filtered to {fmtBand(activeIdx)}</div>
        )}
        <CountLine count={count} total={total} commuteActive={commuteActive} />
      </div>
    );
  }

  // ── Static legend (persona / School default) ───────────────────────────────
  const range = mapMode === "heatmap" ? ALPHA_GLOW_RANGE : colorConfig.range;
  return (
    <div className="absolute left-2 top-16 z-10 max-w-[80vw] border border-border bg-card/90 px-3 py-2 backdrop-blur-md md:bottom-4 md:left-16 md:top-auto md:max-w-[calc(100vw-1rem)]">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Color</span>
        <span className="text-[11px] text-muted-foreground">{colorConfig.legendLow}</span>
        <div
          className="h-1.5 w-24 rounded-full"
          style={{ background: `linear-gradient(to right, ${rgb(range[0])}, ${rgb(range[range.length - 1])})` }}
        />
        <span className="text-[11px] text-foreground">{colorConfig.legendHigh}</span>
      </div>
      <CountLine count={count} total={total} commuteActive={commuteActive} />
    </div>
  );
}
