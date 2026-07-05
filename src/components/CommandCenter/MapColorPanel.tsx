/**
 * MapColorPanel — the "Color By" drawer. Picks which metric paints the map
 * (pins + heat columns). Selecting a band-filterable metric also turns the
 * Status HUD legend into click-to-filter buckets. "Persona default" hands
 * coloring back to the active persona (or School lens).
 */

"use client";

import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { MAP_METRICS } from "@/lib/personas/mapMetrics";

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

function Row({
  label,
  ramp,
  selected,
  hint,
  onClick,
}: {
  label: string;
  ramp?: [number, number, number][];
  selected: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 border px-3 py-2 text-left transition-all",
        selected
          ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200"
          : "border-border bg-card text-foreground hover:border-border hover:text-foreground"
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-medium">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {ramp && (
          <span
            className="h-2 w-12 rounded-full"
            style={{ background: `linear-gradient(to right, ${rgb(ramp[0])}, ${rgb(ramp[ramp.length - 1])})` }}
          />
        )}
        {selected && <Check className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-300" />}
      </span>
    </button>
  );
}

export default function MapColorPanel() {
  const colorMetricId = useCommandCenterStore((s) => s.colorMetricId);
  const setColorMetricId = useCommandCenterStore((s) => s.setColorMetricId);

  return (
    <div className="flex flex-col gap-1.5 p-3">
      <p className="px-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Paint the map by
      </p>
      <Row
        label="Persona default"
        selected={colorMetricId === null}
        hint="Follows the active persona / School lens"
        onClick={() => setColorMetricId(null)}
      />
      {MAP_METRICS.map((m) => (
        <Row
          key={m.id}
          label={m.label}
          ramp={m.range}
          selected={colorMetricId === m.id}
          hint={m.id === "density" ? "Listing count · best in Heatmap" : m.field ? "Click legend bands to filter" : undefined}
          onClick={() => setColorMetricId(m.id)}
        />
      ))}
    </div>
  );
}
