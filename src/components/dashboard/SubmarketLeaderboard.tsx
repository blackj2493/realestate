"use client";

/**
 * SubmarketLeaderboard — "where's the alpha across the GTA".
 *
 * RegionScorecard answers "compare the markets I picked"; this answers the
 * discovery question the incumbents never do: rank ALL the markets and surface
 * where yield / buyer-leverage / inventory is concentrated, then drill in. Pure
 * reuse of the region aggregate data layer (fetchRegionScore) — full-population,
 * deterministic, no AI (§4). Mounted on the (auth-gated) Market Trends page, so
 * no anon gate is needed here.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Trophy, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModuleHead, Panel } from "@/components/daylight/primitives";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";

/** One row of the batched /api/market/leaderboard payload. */
interface LeaderboardRow {
  region: string;
  activeCount: number | null;
  stalePct: number | null;
  medianCapRate: number | null;
}

type RankKey = "yield" | "leverage" | "inventory";

const RANK_OPTIONS: { key: RankKey; label: string; hint: string; field: keyof LeaderboardRow }[] = [
  { key: "yield", label: "Yield", hint: "median cap rate", field: "medianCapRate" },
  { key: "leverage", label: "Buyer leverage", hint: "% stale (60d+ True DOM)", field: "stalePct" },
  { key: "inventory", label: "Inventory", hint: "active listings", field: "activeCount" },
];

export default function SubmarketLeaderboard() {
  const [scores, setScores] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [rankBy, setRankBy] = useState<RankKey>("yield");

  useEffect(() => {
    // One batched request (was 30: fetchRegionScore × 15 markets × 2 endpoints, half of
    // which — the price-trend calls — were never displayed here). `loading` starts true.
    // Bounded by an AbortController so a slow/hung backend can never leave the panel
    // pulsing an empty 8-row skeleton forever — it falls through to the empty state.
    let alive = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    fetch("/api/market/leaderboard", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { markets: [], locked: false }))
      .then((d: { markets?: LeaderboardRow[]; locked?: boolean }) => {
        if (!alive) return;
        setScores(Array.isArray(d.markets) ? d.markets : []);
        setLocked(Boolean(d.locked));
      })
      .catch(() => alive && setScores([]))
      .finally(() => {
        clearTimeout(timer);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, []);

  const opt = RANK_OPTIONS.find((o) => o.key === rankBy)!;
  const ranked = useMemo(() => {
    return [...scores]
      .map((s) => ({ s, v: s[opt.field] as number | null }))
      .sort((a, b) => {
        // Higher is "more" of each lens (more yield / more stale stock / more inventory).
        if (a.v == null && b.v == null) return 0;
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        return b.v - a.v;
      });
  }, [scores, opt.field]);

  const fmtMetric = (v: number) => (rankBy === "inventory" ? v.toLocaleString() : `${v.toFixed(1)}%`);
  // Widest bar = the top-ranked value; every other bar is drawn proportional to it.
  const maxV = ranked.reduce((m, { v }) => Math.max(m, v ?? 0), 0) || 1;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6">
      <section className="space-y-2">
        <ModuleHead
          title="Submarket Leaderboard"
          count={scores.length || undefined}
          icon={<Trophy className="h-4 w-4" />}
          right={
            <span className="inline-flex overflow-hidden border border-border align-middle">
              {RANK_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setRankBy(o.key)}
                  aria-pressed={rankBy === o.key}
                  className={cn(
                    "terminal-font border-l border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors first:border-l-0",
                    rankBy === o.key
                      ? "bg-[color:var(--dt-sig)] text-white dark:bg-muted dark:text-cyan-300"
                      : "bg-card text-muted-foreground hover:text-foreground dark:bg-background"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </span>
          }
        />

        <p className="text-[11px] text-muted-foreground">
          {scores.length ? `${scores.length} ` : ""}GTA markets ranked by {opt.hint} — all active inventory. Click a market to open it in the terminal.
        </p>

        <Panel className="divide-y divide-border/60">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[46px] animate-pulse bg-card/40" />)
          ) : locked ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              Accept the data terms to unlock the full GTA leaderboard.
            </p>
          ) : ranked.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No ranked markets right now — check back after the next daily sync.
            </p>
          ) : (
            ranked.map(({ s, v }, i) => (
                <div key={s.region} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-card/40">
                  <span className={cn("w-6 shrink-0 text-center font-mono text-sm font-bold", i === 0 ? "text-[color:var(--dt-sig)] dark:text-cyan-300" : "text-muted-foreground")}>
                    {i + 1}
                  </span>
                  <Link
                    href={`/properties?city=${encodeURIComponent(s.region)}`}
                    className="terminal-font min-w-0 flex-1 truncate text-sm font-semibold text-foreground hover:text-[color:var(--dt-sig)] dark:hover:text-cyan-300"
                    title={s.region}
                  >
                    {formatRegionLabel(s.region)}
                    <ArrowUpRight className="ml-1 inline h-3 w-3 text-muted-foreground" />
                  </Link>
                  {/* The ranked metric shows once, as the right-aligned bold value; the
                      inline stats carry only the OTHER two so the row never repeats itself. */}
                  <div className="hidden gap-4 font-mono text-xs text-muted-foreground sm:flex">
                    {opt.field !== "medianCapRate" && (
                      <span title="median cap rate">{s.medianCapRate != null ? `${s.medianCapRate.toFixed(1)}% cap` : "— cap"}</span>
                    )}
                    {opt.field !== "stalePct" && (
                      <span title="% stale (60d+ True DOM)">{s.stalePct != null ? `${s.stalePct.toFixed(0)}% stale` : "— stale"}</span>
                    )}
                    {opt.field !== "activeCount" && (
                      <span title="active listings">{s.activeCount != null ? `${s.activeCount.toLocaleString()} active` : "—"}</span>
                    )}
                  </div>
                  {/* Daylight yield bar (light only) — magnitude at a glance. */}
                  {v != null && (
                    <span
                      className="dt-light hidden h-[9px] shrink-0 rounded-[1px] bg-[color:var(--dt-sig)] sm:inline-block"
                      style={{ width: `${Math.max(6, (v / maxV) * 56)}px` }}
                      aria-hidden
                    />
                  )}
                  <span className={cn("w-20 shrink-0 text-right font-mono text-sm font-semibold", i === 0 ? "text-[color:var(--dt-sig)] dark:text-cyan-300" : "text-foreground")}>
                    {v != null ? fmtMetric(v) : "—"}
                  </span>
                </div>
              ))
          )}
        </Panel>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Full-population aggregates over current active inventory (no 100-row sampling). Median cap requires ≥5 priced
          active listings; “stale” = 60d+ True DOM. Deterministic, no AI (§4).
        </p>
      </section>
    </div>
  );
}
