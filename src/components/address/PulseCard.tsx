/**
 * PulseCard — the Home Pulse gauge for the address-profile hero. Server component;
 * the ring draw-in is pure CSS (pp-arc in globals.css). Score + copy come from
 * computePulse() — asking-side only, so this card is anonymous-safe by construction.
 */
import type { Pulse } from "@/lib/address/pulse";
import type { MomentumStats } from "@/lib/address/nearbyForSale";

const R = 52;
const CIRCUMFERENCE = 2 * Math.PI * R; // ≈ 326.7 — pp-arc-in's `from` uses 327

export default function PulseCard({
  pulse,
  momentum,
  medianDaysListed,
  radiusKm,
}: {
  pulse: Pulse;
  momentum: MomentumStats;
  medianDaysListed: number | null;
  radiusKm: number;
}) {
  const dashOffset = CIRCUMFERENCE * (1 - pulse.score / 100);
  const cutPct = Math.round(momentum.cutShare * 100);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card/40 p-5">
      <div className="flex items-center gap-5">
        <div className="relative h-[118px] w-[118px] shrink-0" role="img" aria-label={`Pulse score ${pulse.score} of 100 — ${pulse.label}, ${pulse.lean}`}>
          <svg width="118" height="118" viewBox="0 0 118 118" className="-rotate-90" aria-hidden="true">
            <defs>
              <linearGradient id="pp-pulse-grad" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stopColor="#34d399" />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
            <circle cx="59" cy="59" r={R} fill="none" strokeWidth="9" className="stroke-muted" />
            <circle
              cx="59"
              cy="59"
              r={R}
              fill="none"
              strokeWidth="9"
              strokeLinecap="round"
              stroke="url(#pp-pulse-grad)"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="pp-arc"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-3xl font-bold tabular-nums text-foreground">{pulse.score}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Pulse</span>
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground">
            {pulse.label} —{" "}
            <span className={pulse.score >= 58 ? "text-amber-600 dark:text-amber-400" : "text-cyan-700 dark:text-cyan-400"}>
              {pulse.lean}
            </span>
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{pulse.blurb}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-md border border-border">
        <div className="bg-card/60 px-3 py-2">
          <p className="font-mono text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            +{momentum.newThisWeek}
          </p>
          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">new this wk</p>
        </div>
        <div className="bg-card/60 px-3 py-2">
          <p className="font-mono text-base font-bold tabular-nums text-foreground">
            {medianDaysListed !== null ? `${Math.round(medianDaysListed)}d` : "—"}
          </p>
          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">median listed</p>
        </div>
        <div className="bg-card/60 px-3 py-2">
          <p className="font-mono text-base font-bold tabular-nums text-amber-600 dark:text-amber-400">{cutPct}%</p>
          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">have cut price</p>
        </div>
      </div>

      <p className="mt-2.5 font-mono text-[10px] text-muted-foreground">
        Scored nightly from live asking-side activity within {radiusKm} km
      </p>
    </div>
  );
}
