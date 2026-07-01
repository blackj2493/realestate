// src/components/Property/DeltaChips.tsx
"use client";

import type { AttrDelta } from "@/lib/property/similarListings";

/**
 * HouseSigma-style comparison chips — each shows one attribute's difference vs the
 * subject listing ("+1 bed", "-$240K", "+200 sqft"). Physical "more" reads positive
 * (emerald); "less" is muted (slate). Price stays neutral — we don't colour-judge it.
 */
export function DeltaChips({ deltas, className = "" }: { deltas: AttrDelta[]; className?: string }) {
  if (!deltas.length) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {deltas.map((d) => {
        const cls =
          d.kind === "price"
            ? "bg-muted/70 text-foreground"
            : d.direction === "up"
              ? "bg-emerald-400/10 text-emerald-300"
              : "bg-muted/40 text-muted-foreground";
        return (
          <span
            key={d.kind}
            title="vs this property"
            className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] ${cls}`}
          >
            {d.label}
          </span>
        );
      })}
    </div>
  );
}
