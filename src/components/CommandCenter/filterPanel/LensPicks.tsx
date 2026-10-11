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
  home: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300",
  yield: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  deal: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
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
      <div className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-cyan-700 dark:text-cyan-300">
        {titleIcon}
        {title}
        <span className="ml-auto font-medium normal-case tracking-normal text-muted-foreground">homes in view</span>
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
                "relative flex w-[136px] shrink-0 flex-col items-start gap-2 rounded-2xl border-[1.5px] bg-card p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors dark:shadow-none",
                active
                  ? "border-cyan-600 dark:border-cyan-400 dark:shadow-[0_0_14px_rgba(34,211,238,0.18)]"
                  : "border-transparent hover:border-cyan-500/40 dark:border-border",
                empty && "cursor-not-allowed opacity-45 hover:border-transparent"
              )}
            >
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", TONE[tone])}>
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              {active && (
                <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-600 text-white dark:bg-cyan-400 dark:text-slate-950">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                </span>
              )}
              <span className="text-[13px] font-semibold leading-tight text-foreground">{pick.label}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {count === undefined ? (
                  <span className="inline-block h-3 w-14 animate-pulse rounded bg-muted align-middle" aria-label="Counting" />
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
