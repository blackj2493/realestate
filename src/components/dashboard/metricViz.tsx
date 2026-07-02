"use client";

/**
 * metricViz — shared comparison-visual primitives for the dashboard's comparison
 * band. Extracted from RegionScorecard so both the scorecard table and the
 * persona-driven comparison tiles render trend/delta/temperature identically.
 *
 * Every primitive expresses a metric RELATIVE to something (prior year, peer
 * regions, market temperature) — the redesign rule that no number ships bare.
 */

import { LineChart, Line } from "recharts";
import type { RegionScore } from "@/lib/dashboard/marketAggregates";

export const DASH = "—";

export function compactPrice(n: number): string {
  if (n >= 1_000_000) return `$${(Math.round((n / 1_000_000) * 100) / 100).toString()}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

export const orDash = (v: number | null | undefined, fn: (n: number) => string) =>
  v == null ? DASH : fn(v);

/** Year-over-year delta chip (▲/▼ N% YoY). Green up / red down — price context. */
export function YoY({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={`terminal-font text-[10px] ${up ? "text-emerald-400" : "text-rose-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% YoY
    </span>
  );
}

export function Sparkline({
  data,
  width = 84,
  height = 26,
}: {
  data: { month: string; v: number }[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  return (
    <LineChart width={width} height={height} data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
      <Line type="monotone" dataKey="v" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} />
    </LineChart>
  );
}

export const TEMP: Record<
  NonNullable<RegionScore["temperature"]>,
  { label: string; cls: string; rank: number }
> = {
  hot: { label: "Hot", cls: "text-rose-400 bg-rose-400/10 border-rose-400/30", rank: 3 },
  balanced: { label: "Balanced", cls: "text-amber-400 bg-amber-400/10 border-amber-400/30", rank: 2 },
  cold: { label: "Cold", cls: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30", rank: 1 },
};

export function TemperatureBadge({
  temperature,
}: {
  temperature: RegionScore["temperature"];
}) {
  if (!temperature) return <span className="text-xs text-muted-foreground">{DASH}</span>;
  const t = TEMP[temperature];
  return (
    <span
      className={`terminal-font rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${t.cls}`}
    >
      {t.label}
    </span>
  );
}

/**
 * Peer-comparison chip: value vs the median of the OTHER regions. `dir` says which
 * way is favourable so the color reads as good/bad rather than just up/down.
 *  - higherGood: cap rate (more yield is better)
 *  - lowerGood:  months supply, % stale, $/sqft entry price
 *  - neutral:    informational, no value judgement (slate)
 */
export function PeerDelta({
  value,
  peerMedian,
  format,
  dir,
}: {
  value: number;
  peerMedian: number | null;
  format: (n: number) => string;
  dir: "higherGood" | "lowerGood" | "neutral";
}) {
  if (peerMedian == null) return null;
  const delta = value - peerMedian;
  if (Math.abs(delta) < 1e-9) {
    return (
      <span className="terminal-font text-[10px] text-muted-foreground">= peer avg</span>
    );
  }
  const up = delta > 0;
  const favourable =
    dir === "neutral" ? null : dir === "higherGood" ? up : !up;
  const cls =
    favourable == null
      ? "text-muted-foreground"
      : favourable
        ? "text-emerald-400"
        : "text-rose-400";
  return (
    <span className={`terminal-font text-[10px] ${cls}`}>
      {up ? "▲" : "▼"} {format(Math.abs(delta))} vs peers
    </span>
  );
}
