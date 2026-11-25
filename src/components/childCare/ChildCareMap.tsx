"use client";

/**
 * Toronto neighbourhoods shaded by child care spaces per 100 children under 5.
 * One hue (teal) at five opacity steps, so it reads on the light and the dark card.
 * Hover (or tap) a neighbourhood to see its numbers in the panel under the map; the
 * full numbers are also in the table below, so nothing depends on the hover.
 */
import { useState } from "react";
import type { MapShape } from "@/lib/childcare/childCarePage";

const TEAL = "#0d9488";
const OPACITY = [0.1, 0.28, 0.48, 0.7, 0.95];

export default function ChildCareMap({
  width,
  height,
  shapes,
  labels,
  cityPer100,
}: {
  width: number;
  height: number;
  shapes: MapShape[];
  labels: readonly string[];
  cityPer100: number;
}) {
  const [hit, setHit] = useState<MapShape | null>(null);
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Map of Toronto's 158 neighbourhoods, shaded by child care spaces per 100 children under 5"
        onMouseLeave={() => setHit(null)}
      >
        {shapes.map((s) => (
          <path
            key={s.name}
            d={s.d}
            fill={TEAL}
            fillOpacity={OPACITY[s.step]}
            stroke="hsl(var(--card))"
            strokeWidth={1}
            onMouseEnter={() => setHit(s)}
            onClick={() => setHit(s)}
            className="cursor-pointer"
          >
            <title>{`${s.name}: ${Math.round(s.per100)} spaces per 100 children`}</title>
          </path>
        ))}
        {hit && <path d={hit.d} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2} pointerEvents="none" />}
      </svg>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-sm" style={{ background: TEAL, opacity: OPACITY[i] }} />
            {l}
          </span>
        ))}
      </div>

      <div className="mt-3 min-h-[64px] rounded-lg border border-border bg-card p-3 text-sm" aria-live="polite">
        {hit ? (
          <>
            <p className="font-semibold text-foreground">
              {hit.name}: {Math.round(hit.per100)} spaces per 100 children under 5
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {hit.youngSpaces.toLocaleString("en-CA")} infant, toddler and preschool spaces ({hit.infant} infant) in {hit.centres}{" "}
              {hit.centres === 1 ? "centre" : "centres"}, for {hit.children.toLocaleString("en-CA")} children under 5. Toronto:{" "}
              {Math.round(cityPer100)}.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">Hover over or tap a neighbourhood to see its numbers.</p>
        )}
      </div>
    </div>
  );
}
