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

function CountLine({
  count,
  total,
  commuteActive,
  className = "mt-1.5",
}: {
  count: number;
  total: number;
  commuteActive: boolean;
  className?: string;
}) {
  const capped = total > count;
  return (
    <div className={cn("font-mono text-xs text-foreground", className)}>
      <span className="font-semibold text-cyan-700 dark:text-cyan-400">{count}</span>
      {capped ? ` of ${total.toLocaleString()}` : ""} in {commuteActive ? "commute zone" : "view"}
      {/* The zoom hint is desktop-only — on phones the legend is a single slim line. */}
      {capped && <span className="ml-1.5 hidden text-muted-foreground md:inline">· zoom in to see all</span>}
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
      // Phones: top-left corner (the mode pill moved to the collapsed top-right
      // button), tighter padding. Stays stacked — the band buttons are tappable
      // filters, so this variant earns its two rows.
      <div className="absolute left-2 top-2.5 z-10 max-w-[calc(100vw-64px)] border border-border bg-card/90 px-2 py-1.5 backdrop-blur-md md:bottom-4 md:left-16 md:top-auto md:max-w-[calc(100vw-1rem)] md:px-3 md:py-2">
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
  // pointer-events-none: nothing here is interactive, and on phones this panel sits
  // top-left over the map — a tappable legend was swallowing pin taps beneath it.
  // The interactive variant above keeps pointer events (band buttons).
  // Phones: ONE slim row at the top-left corner (the mode pill that used to sit
  // there is now the collapsed top-right button); desktop keeps the stacked
  // bottom-left panel unchanged.
  const range = mapMode === "heatmap" ? ALPHA_GLOW_RANGE : colorConfig.range;
  return (
    <div className="pointer-events-none absolute left-2 top-2.5 z-10 flex max-w-[calc(100vw-64px)] items-center gap-2 border border-border bg-card/90 px-2 py-1 backdrop-blur-md md:bottom-4 md:left-16 md:top-auto md:block md:max-w-[calc(100vw-1rem)] md:px-3 md:py-2">
      <div className="flex items-center gap-2">
        <span className="hidden text-[9px] font-semibold uppercase tracking-wider text-muted-foreground md:inline">
          Color
        </span>
        <span className="text-[11px] text-muted-foreground">{colorConfig.legendLow}</span>
        <div
          className="h-1.5 w-14 rounded-full md:w-24"
          style={{ background: `linear-gradient(to right, ${rgb(range[0])}, ${rgb(range[range.length - 1])})` }}
        />
        <span className="text-[11px] text-foreground">{colorConfig.legendHigh}</span>
      </div>
      <CountLine count={count} total={total} commuteActive={commuteActive} className="mt-0 md:mt-1.5" />
    </div>
  );
}
