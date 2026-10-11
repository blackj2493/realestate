"use client";

/**
 * The lens's one-tap picks: three or four cards, each with the number of homes in view it
 * would leave. The count is the point. A reader sees "Separate entrance · 412" before
 * tapping, so nothing on this row leads to an empty map, and a pick that would show no
 * homes is greyed out instead of offered.
 */

import React from "react";
import {
  Building2,
  Car,
  Check,
  DoorOpen,
  Footprints,
  Gavel,
  Hammer,
  Hourglass,
  KeyRound,
  LandPlot,
  Percent,
  Ruler,
  TrendingDown,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pickKey, type PickDef } from "@/lib/filters/filterPanelConfig";

type Tone = "home" | "yield" | "deal";

const LOOK: Record<string, { icon: LucideIcon; tone: Tone }> = {
  "signal:separate_entrance": { icon: DoorOpen, tone: "home" },
  "signal:walkout_basement": { icon: Footprints, tone: "home" },
  "signal:tenanted": { icon: Users, tone: "yield" },
  "signal:power_of_sale": { icon: Gavel, tone: "deal" },
  "signal:needs_work": { icon: Hammer, tone: "deal" },
  "toggle:duplexCandidate": { icon: KeyRound, tone: "home" },
  "toggle:staleOnly": { icon: Hourglass, tone: "deal" },
  "toggle:zoningPotential": { icon: Building2, tone: "home" },
  minPriceDrop: { icon: TrendingDown, tone: "deal" },
  minCapRate: { icon: Percent, tone: "yield" },
  minFrontage: { icon: Ruler, tone: "home" },
  minLotSqft: { icon: LandPlot, tone: "home" },
  minSurplusParking: { icon: Car, tone: "home" },
};

const TONE: Record<Tone, string> = {
  home: "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  yield: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  deal: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

function look(p: PickDef) {
  return LOOK[pickKey(p)] ?? (p.kind === "threshold" ? LOOK[p.key] : undefined) ?? { icon: Check, tone: "home" as Tone };
}

export interface PickView {
  pick: PickDef;
  active: boolean;
  /** Homes in view with this pick applied; undefined while counting. */
  count: number | undefined;
}

export default function LensPicks({
  title,
  titleIcon,
  picks,
  onToggle,
}: {
  title: string;
  titleIcon: React.ReactNode;
  picks: PickView[];
  onToggle: (p: PickDef) => void;
}) {
  if (!picks.length) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
        {titleIcon}
        {title}
        <span className="ml-auto text-muted-foreground">Homes in view</span>
      </div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {picks.map(({ pick, active, count }) => {
          const { icon: Icon, tone } = look(pick);
          const empty = !active && count === 0;
          return (
            <button
              key={pickKey(pick)}
              type="button"
              aria-pressed={active}
              disabled={empty}
              onClick={() => onToggle(pick)}
              className={cn(
                "relative flex w-[132px] shrink-0 flex-col items-start gap-2 border bg-card p-3 text-left transition-colors",
                active ? "border-cyan-500/60 bg-cyan-500/10" : "border-border hover:border-cyan-500/50",
                empty && "cursor-not-allowed opacity-40 hover:border-border"
              )}
            >
              <span className={cn("flex h-8 w-8 items-center justify-center border", TONE[tone])}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              {active && (
                <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center bg-cyan-500 text-slate-950">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                </span>
              )}
              <span className="text-xs font-semibold leading-tight text-foreground">{pick.label}</span>
              <span
                className={cn(
                  "font-mono text-[11px] font-semibold",
                  active ? "text-cyan-700 dark:text-cyan-400" : "text-muted-foreground"
                )}
              >
                {count === undefined ? (
                  <span className="inline-block h-3 w-14 animate-pulse bg-muted align-middle" aria-label="Counting" />
                ) : (
                  `${count.toLocaleString("en-US")} ${count === 1 ? "home" : "homes"}`
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
