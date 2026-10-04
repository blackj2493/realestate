"use client";

/**
 * CityPartChips — the second row a too-big city's chip opens: "Which part of Toronto?"
 * with one chip per part (cityParts.ts). Each chip names the part and a few neighbourhoods
 * people recognise, because the part names alone ("West End and York") do not tell a
 * newcomer where Roncesvalles is.
 *
 * Presentational only: the caller owns what a pick does (select it in the signup form,
 * follow it straight away in AreaFollowPrompt).
 */

import { cn } from "@/lib/utils";
import type { CityPart } from "@/lib/dashboard/cityParts";

export default function CityPartChips({
  parent,
  parts,
  selected,
  onPick,
  disabled = false,
}: {
  parent: string;
  parts: readonly CityPart[];
  selected?: string | null;
  onPick: (name: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 border border-cyan-600/40 bg-background/60 p-2.5 dark:border-cyan-400/30">
      <p className="text-[12px] font-medium text-foreground">Which part of {parent}?</p>
      <div role="group" aria-label={`Parts of ${parent}`} className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {parts.map((p) => {
          const active = selected === p.name;
          return (
            <button
              key={p.name}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onPick(p.name)}
              className={cn(
                "flex min-h-[44px] flex-col items-start justify-center border px-3 py-1.5 text-left transition-colors disabled:opacity-60 sm:min-h-[40px]",
                active
                  ? "border-emerald-500 bg-emerald-500/15"
                  : "border-border bg-card hover:border-cyan-600/60"
              )}
            >
              <span
                className={cn(
                  "text-xs font-medium",
                  active ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"
                )}
              >
                {p.name}
              </span>
              <span className="text-[10.5px] leading-snug text-muted-foreground">{p.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
