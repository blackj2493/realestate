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
import { fetchRegionScore, type RegionScore } from "@/lib/dashboard/marketAggregates";
import { REGION_TO_CITIES, citiesFromRegions } from "@/lib/dashboard/config";
import { cn } from "@/lib/utils";

/** Curated GTA market set, flattened from the apply-flow region map. */
const MARKETS = citiesFromRegions(Object.keys(REGION_TO_CITIES));

type RankKey = "yield" | "leverage" | "inventory";

const RANK_OPTIONS: { key: RankKey; label: string; hint: string; field: keyof RegionScore }[] = [
  { key: "yield", label: "Yield", hint: "median cap rate", field: "medianCapRate" },
  { key: "leverage", label: "Buyer leverage", hint: "% stale (90d+ True DOM)", field: "stalePct" },
  { key: "inventory", label: "Inventory", hint: "active listings", field: "activeCount" },
];

export default function SubmarketLeaderboard() {
  const [scores, setScores] = useState<RegionScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [rankBy, setRankBy] = useState<RankKey>("yield");

  useEffect(() => {
    // Fetch once on mount; `loading` already starts true, so no setState here.
    let alive = true;
    Promise.allSettled(MARKETS.map((m) => fetchRegionScore(m)))
      .then((rs) => {
        if (!alive) return;
        setScores(rs.map((r, i) => (r.status === "fulfilled" ? r.value : emptyScore(MARKETS[i]))));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
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

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <h2 className="terminal-font flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-100">
            <Trophy className="h-4 w-4 text-cyan-400" /> Submarket Leaderboard
          </h2>
          <div className="inline-flex overflow-hidden rounded-md border border-slate-700">
            {RANK_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setRankBy(o.key)}
                aria-pressed={rankBy === o.key}
                className={cn(
                  "terminal-font px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors",
                  rankBy === o.key ? "bg-slate-800 text-cyan-300" : "bg-slate-950 text-slate-400 hover:text-slate-200"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-slate-500">
          {MARKETS.length} GTA markets ranked by {opt.hint} — all active inventory. Click a market to open it in the terminal.
        </p>

        <div className="divide-y divide-slate-800/60 border border-slate-800">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[46px] animate-pulse bg-slate-900/40" />)
            : ranked.map(({ s, v }, i) => (
                <div key={s.region} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-slate-900/40">
                  <span className={cn("w-6 shrink-0 text-center font-mono text-sm font-bold", i === 0 ? "text-cyan-300" : "text-slate-500")}>
                    {i + 1}
                  </span>
                  <Link
                    href={`/properties?city=${encodeURIComponent(s.region)}`}
                    className="terminal-font min-w-0 flex-1 truncate text-sm font-semibold text-slate-100 hover:text-cyan-300"
                  >
                    {s.region}
                    <ArrowUpRight className="ml-1 inline h-3 w-3 text-slate-600" />
                  </Link>
                  <div className="hidden gap-4 font-mono text-xs text-slate-400 sm:flex">
                    <span title="median cap rate">{s.medianCapRate != null ? `${s.medianCapRate.toFixed(1)}% cap` : "— cap"}</span>
                    <span title="% stale (90d+ True DOM)">{s.stalePct != null ? `${s.stalePct.toFixed(0)}% stale` : "— stale"}</span>
                    <span title="active listings">{s.activeCount != null ? `${s.activeCount.toLocaleString()} active` : "—"}</span>
                  </div>
                  <span className={cn("w-20 shrink-0 text-right font-mono text-sm font-semibold", i === 0 ? "text-cyan-300" : "text-slate-200")}>
                    {v != null ? fmtMetric(v) : "—"}
                  </span>
                </div>
              ))}
        </div>

        <p className="text-[11px] leading-relaxed text-slate-600">
          Full-population aggregates over current active inventory (no 100-row sampling). Median cap requires ≥5 priced
          active listings; “stale” = 90d+ True DOM. Deterministic, no AI (§4).
        </p>
      </section>
    </div>
  );
}

function emptyScore(region: string): RegionScore {
  return {
    region,
    medianPrice: null,
    priceSeries: [],
    yoyPct: null,
    medianPpsf: null,
    ppsfYoyPct: null,
    activeCount: null,
    monthsOfSupply: null,
    soldToListPct: null,
    pctOverAsking: null,
    medianCapRate: null,
    topCapRate: null,
    stalePct: null,
    temperature: null,
  };
}
