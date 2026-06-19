/**
 * AmenityFilter — walkability lens, rendered directly inside the "Walkable To" drawer
 * of the Instrument Deck rail (no chip / popover wrapper — the drawer already provides
 * the panel, header, and close button).
 *
 * Picks an amenity kind (grocery / recreation / either) and a max straight-line
 * distance, which the terminal search turns into a NearestGroceryKm:<=X and/or
 * NearestRecCentreKm:<=X filter (precomputed fields, deterministic §4). Distances come
 * from Overture Maps `places` (CDLA-Permissive) — see build-amenities-dataset.ts.
 */

"use client";

import React from "react";
import { ShoppingCart, Dumbbell, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { useCommandCenterStore, type AmenityKind } from "@/lib/stores/commandCenterStore";

const KINDS: { id: AmenityKind; label: string; icon: typeof ShoppingCart }[] = [
  { id: "grocery", label: "Grocery", icon: ShoppingCart },
  { id: "recreation", label: "Recreation", icon: Dumbbell },
  { id: "either", label: "Either", icon: MapPin },
];

const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

const segBtn = (selected: boolean) =>
  cn(
    "flex flex-1 items-center justify-center gap-1.5 rounded-none border px-2 py-1.5 text-xs font-medium transition-all",
    selected
      ? "border-cyan-600/50 bg-cyan-900/30 text-cyan-300"
      : "border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200"
  );

export default function AmenityFilter() {
  const amenity = useCommandCenterStore((s) => s.amenity);
  const setAmenity = useCommandCenterStore((s) => s.setAmenity);
  const resetAmenity = useCommandCenterStore((s) => s.resetAmenity);

  return (
    <div>
      {/* Amenity kind */}
      <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Walkable to
      </label>
      <div className="flex gap-1.5">
        {KINDS.map((k) => {
          const Icon = k.icon;
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => setAmenity({ kind: k.id, enabled: true })}
              className={segBtn(amenity.kind === k.id)}
            >
              <Icon className="h-3.5 w-3.5" />
              {k.label}
            </button>
          );
        })}
      </div>

      {/* Max distance */}
      <div className="mb-1.5 mt-4 flex items-center justify-between">
        <label className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Max distance
        </label>
        <span className="font-mono text-xs text-cyan-300">{fmtKm(amenity.maxKm)}</span>
      </div>
      <Slider
        value={[amenity.maxKm]}
        onValueChange={([v]) => setAmenity({ maxKm: v, enabled: true })}
        min={0.25}
        max={3}
        step={0.25}
      />

      {/* Footer — clear the lens (the drawer's own X closes the panel). */}
      <div className="mt-4">
        <button
          type="button"
          onClick={resetAmenity}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Clear
        </button>
      </div>
      <p className="mt-3 text-[9px] leading-tight text-slate-600">
        Straight-line distance to the nearest grocery / recreation centre. Places ©
        OpenStreetMap contributors, © Overture Maps Foundation.
      </p>
    </div>
  );
}
