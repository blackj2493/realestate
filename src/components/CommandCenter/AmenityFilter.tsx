/**
 * AmenityFilter — walkability lens for the Instrument Deck (global across personas).
 *
 * Picks an amenity kind (grocery / recreation / either) and a max straight-line
 * distance, which the terminal search turns into a NearestGroceryKm:<=X and/or
 * NearestRecCentreKm:<=X filter (precomputed fields, deterministic §4). Distances come
 * from Overture Maps `places` (CDLA-Permissive) — see build-amenities-dataset.ts.
 *
 * Simpler than SchoolFilter: no autocomplete and no extra API — just a kind toggle and
 * a distance slider over indexed fields.
 */

"use client";

import React from "react";
import { ShoppingCart, Dumbbell, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { useCommandCenterStore, type AmenityKind } from "@/lib/stores/commandCenterStore";

const KINDS: { id: AmenityKind; label: string; icon: typeof ShoppingCart }[] = [
  { id: "grocery", label: "Grocery", icon: ShoppingCart },
  { id: "recreation", label: "Recreation", icon: Dumbbell },
  { id: "either", label: "Either", icon: MapPin },
];

const KIND_SHORT: Record<AmenityKind, string> = {
  grocery: "Grocery",
  recreation: "Rec",
  either: "Grocery/Rec",
};

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

  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const summary = `${KIND_SHORT[amenity.kind]} ≤${fmtKm(amenity.maxKm)}`;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between gap-2 border px-3 py-2 text-xs font-mono uppercase tracking-wider transition-all",
          amenity.enabled
            ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
            : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200"
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ShoppingCart className="h-4 w-4 shrink-0" />
          {amenity.enabled ? <span className="truncate normal-case">{summary}</span> : "Walkable To"}
        </span>
        {amenity.enabled ? (
          <X
            className="h-4 w-4 shrink-0 text-cyan-400/70 hover:text-cyan-200"
            onClick={(e) => {
              e.stopPropagation();
              resetAmenity();
            }}
          />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 bg-slate-600" />
        )}
      </button>

      {open && (
        <div className="absolute left-full top-0 z-30 ml-2 w-72 rounded-none border border-slate-700 bg-slate-900 p-4">
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

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={resetAmenity}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-none bg-cyan-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600"
            >
              Done
            </button>
          </div>
          <p className="mt-3 text-[9px] leading-tight text-slate-600">
            Straight-line distance to the nearest grocery / recreation centre. Places ©
            OpenStreetMap contributors, © Overture Maps Foundation.
          </p>
        </div>
      )}
    </div>
  );
}
