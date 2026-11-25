/**
 * ChildCareFilter — licensed child care lens, rendered directly inside the "Child care"
 * drawer of the Instrument Deck rail (the drawer provides the panel, header and close).
 *
 * Picks a centre kind (infant care / any licensed centre / $10-a-day) and a straight-line
 * distance, which the terminal search turns into one NearestInfantCareKm:<=X,
 * NearestChildCareKm:<=X or NearestCwelccKm:<=X filter (precomputed fields, see
 * lib/childcare/nearestChildCare). Toronto only: the City of Toronto is the one source
 * with centre locations and spaces by age group. "Show centres on the map" draws the
 * centres as pins (ChildCareCentresLayer).
 */

"use client";

import React from "react";
import { Baby, Building2, BadgeDollarSign, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore, type ChildCareKind } from "@/lib/stores/commandCenterStore";

const KINDS: { id: ChildCareKind; label: string; icon: typeof Baby }[] = [
  { id: "infant", label: "Infant care (under 18 months)", icon: Baby },
  { id: "any", label: "Any licensed centre", icon: Building2 },
  { id: "cwelcc", label: "$10-a-day centre", icon: BadgeDollarSign },
];

const DISTANCES: { km: number; label: string }[] = [
  { km: 0.5, label: "500 m" },
  { km: 1, label: "1 km" },
  { km: 2, label: "2 km" },
];

const segBtn = (selected: boolean) =>
  cn(
    "flex items-center gap-1.5 rounded-none border px-2 py-1.5 text-xs font-medium transition-all",
    selected
      ? "border-cyan-600/50 bg-cyan-900/30 text-cyan-700 dark:text-cyan-300"
      : "border-border bg-muted text-muted-foreground hover:text-foreground"
  );

export default function ChildCareFilter() {
  const childCare = useCommandCenterStore((s) => s.childCare);
  const setChildCare = useCommandCenterStore((s) => s.setChildCare);
  const resetChildCare = useCommandCenterStore((s) => s.resetChildCare);

  return (
    <div>
      {/* On / off */}
      <button
        type="button"
        role="switch"
        aria-checked={childCare.enabled}
        onClick={() => setChildCare({ enabled: !childCare.enabled })}
        className={cn(
          "mb-4 flex w-full items-center justify-between border px-3 py-2 text-xs font-medium transition-all",
          childCare.enabled
            ? "border-cyan-600/50 bg-cyan-900/30 text-cyan-700 dark:text-cyan-300"
            : "border-border bg-muted text-foreground hover:text-foreground"
        )}
      >
        <span className="flex items-center gap-2">
          <Baby className="h-3.5 w-3.5" /> Filter homes by child care
        </span>
        <span
          className={cn("h-3 w-6 rounded-full transition-colors", childCare.enabled ? "bg-cyan-500" : "bg-slate-600")}
        />
      </button>

      {/* Kind */}
      <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Show homes near:
      </label>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Show homes near">
        {KINDS.map((k) => {
          const Icon = k.icon;
          const selected = childCare.kind === k.id;
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setChildCare({ kind: k.id, enabled: true })}
              className={segBtn(selected)}
            >
              <Icon className="h-3.5 w-3.5" />
              {k.label}
            </button>
          );
        })}
      </div>

      {/* Distance */}
      <label className="mb-1.5 mt-4 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Within:
      </label>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Within">
        {DISTANCES.map((d) => {
          const selected = childCare.maxKm === d.km;
          return (
            <button
              key={d.km}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setChildCare({ maxKm: d.km, enabled: true })}
              className={cn(segBtn(selected), "flex-1 justify-center")}
            >
              {d.label}
            </button>
          );
        })}
      </div>

      {/* Centre pins */}
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={childCare.showCentres}
          onChange={(e) => setChildCare({ showCentres: e.target.checked })}
          className="h-3.5 w-3.5 accent-cyan-600"
        />
        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
        Show centres on the map
      </label>

      {/* Footer — clear the lens (the drawer's own X closes the panel). */}
      <div className="mt-4">
        <button type="button" onClick={resetChildCare} className="text-xs text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>
      <p className="mt-3 text-[9px] leading-tight text-muted-foreground">
        Toronto only · City of Toronto licensed centres. Spaces are licensed capacity, not open spots.
      </p>
    </div>
  );
}
