"use client";

/**
 * Neighbourhood Heat — ranked community (CityRegion) leaderboard for one watched
 * region. Stats come from /api/dashboard/neighbourhood-heat, which aggregates the
 * region's FULL active inventory server-side (owner call 2026-07-25: the old
 * 100-listing browser sample gave big-city communities 1–3 listings each, so the
 * ranking was noise). Only communities with MIN_COMMUNITY_N+ listings rank, and
 * the tile hides itself entirely when no metric can field a credible leaderboard
 * (silent-null convention — better absent than noisy).
 *
 * Rows: rank | fixed-width name (shared bar baseline) | inline range-scaled bar |
 * median | ×n. Bars scale to the RANGE of shown medians (tight spreads still read
 * as a ranking). Every row deep-links to the Map Terminal at the community's
 * listing centroid. Two balanced columns on lg+.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Layers } from "lucide-react";
import {
  COLLAPSED_ROWS,
  MIN_COMMUNITY_N,
  MIN_QUALIFYING_COMMUNITIES,
  hasUsableHeat,
  type CommunityStat,
  type HeatStats,
} from "@/lib/dashboard/neighbourhoodHeat";
import RegionSwitcher from "./RegionSwitcher";

type MetricId = "cap" | "dom" | "drop" | "price";

const fmtMoney = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M` : `$${Math.round(v / 1000)}k`;

// Order = owner call 2026-07-25: lead with the lens every user understands
// (Asking $, also the default), then the bargain lenses, investor yield last.
const METRICS: { id: MetricId; label: string; fmt: (v: number) => string }[] = [
  { id: "price", label: "Asking $", fmt: fmtMoney },
  { id: "drop", label: "Price Drop", fmt: fmtMoney },
  { id: "dom", label: "True DOM", fmt: (v) => `${Math.round(v)}d` },
  { id: "cap", label: "Cap Rate", fmt: (v) => `${v.toFixed(1)}%` },
];

const METRIC_CAPTION: Record<MetricId, string> = {
  cap: "Communities where active listings show the highest cap rates (rental yield).",
  dom: "Communities where active listings have sat on the market the longest.",
  drop: "Communities where sellers have made the deepest price cuts.",
  price: "Communities ranked by median asking price — premium pockets first, most affordable last.",
};

/**
 * OREB CityRegion values arrive as "7711 - Barrhaven - Half Moon Bay" — strip the
 * numeric board code and the redundant own-city prefix for display ("Half Moon
 * Bay"). Raw value stays the grouping key; TRREB names without codes pass through.
 */
function displayName(region: string, city: string): string {
  let n = region.replace(/^\d{3,4}\s*-\s*/, "").trim();
  const cityPrefix = new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-\\s*`, "i");
  n = n.replace(cityPrefix, "").trim();
  return n || region;
}

export default function NeighbourhoodLeaderboard({
  regions,
  selected,
  onSelect,
}: {
  regions: string[];
  selected: string;
  onSelect: (region: string) => void;
}) {
  const [metric, setMetric] = useState<MetricId>("price");
  const [heat, setHeat] = useState<HeatStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setExpanded(false); // a new region is a new ranking — start compact again
    fetch(`/api/dashboard/neighbourhood-heat?region=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setHeat(d.heat ?? null);
      })
      .catch(() => alive && setHeat(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [selected]);

  const m = METRICS.find((x) => x.id === metric)!;
  const allRows: CommunityStat[] = heat?.[metric] ?? [];
  const rows = expanded ? allRows : allRows.slice(0, COLLAPSED_ROWS);

  // No metric can field a credible leaderboard here — the tile says nothing, so it
  // says nothing (silent-null convention).
  if (!loading && (!heat || !hasUsableHeat(heat))) return null;

  // Bars scale to the RANGE of the rows on screen, not zero: cap rates cluster
  // (4.2–4.8%), so a zero-based scale rendered near-identical full-width stripes.
  const minMedian = rows.length ? rows[rows.length - 1].median : 0;
  const maxMedian = rows.length ? rows[0].median : 1;
  const barPct = (v: number) =>
    maxMedian === minMedian ? 100 : 15 + 85 * ((v - minMedian) / (maxMedian - minMedian));

  const mapUrl = `/properties?city=${encodeURIComponent(selected)}`;

  // One-line row: rank | name (fixed col, so every bar starts on a shared baseline)
  // | inline range-scaled bar | value | ×n.
  const renderRow = (r: CommunityStat, rank: number) => (
    <li key={r.name}>
      <Link
        href={`/properties?lat=${r.lat.toFixed(6)}&lng=${r.lng.toFixed(6)}&z=14`}
        className="group flex h-11 items-center gap-3 px-3.5 transition-colors hover:bg-cyan-500/5"
      >
        <span
          className={`terminal-font w-4 shrink-0 text-right font-mono text-[10px] font-bold ${
            rank === 1 ? "text-cyan-700 dark:text-cyan-300" : "text-muted-foreground"
          }`}
        >
          {rank}
        </span>
        <span className="w-36 shrink-0 truncate text-sm font-medium text-foreground group-hover:text-cyan-700 sm:w-48 dark:group-hover:text-cyan-300">
          {displayName(r.name, selected)}
        </span>
        <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-sm bg-muted/30">
          <span
            className="block h-full rounded-sm bg-gradient-to-r from-cyan-600/80 to-cyan-400 dark:from-cyan-500/60 dark:to-cyan-300/90"
            style={{ width: `${barPct(r.median)}%` }}
          />
        </span>
        <span className="terminal-font w-14 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-foreground">
          {m.fmt(r.median)}
        </span>
        <span className="terminal-font w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
          ×{r.count}
        </span>
      </Link>
    </li>
  );

  // Two balanced columns on lg+ (ranks 1–3 | 4–6) — full-width rows on a wide
  // monitor read as sparse stripes; two tidy columns read as an instrument.
  const split = Math.ceil(rows.length / 2);
  const colA = rows.slice(0, split);
  const colB = rows.slice(split);

  return (
    <section className="dt-panel dt-reg border border-border bg-card dark:bg-card/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
            Neighbourhood Heat{regions.length > 1 ? "" : ` — ${selected}`}
          </h2>
          {regions.length > 1 && (
            <RegionSwitcher regions={regions} selected={selected} onSelect={onSelect} />
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border">
            {METRICS.map((x) => {
              const active = x.id === metric;
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setMetric(x.id)}
                  aria-pressed={active}
                  className={`terminal-font border-r border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors last:border-r-0 ${
                    active
                      ? "bg-cyan-600 text-white dark:bg-cyan-500/20 dark:text-cyan-300"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {x.label}
                </button>
              );
            })}
          </div>
          <Link
            href={mapUrl}
            className="terminal-font flex items-center gap-1 text-[11px] uppercase tracking-wider text-cyan-700 dark:text-cyan-400 hover:underline"
          >
            Open map <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 p-3 lg:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-9 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : rows.length < MIN_QUALIFYING_COMMUNITIES ? (
        <div className="flex h-32 items-center justify-center text-center">
          <div>
            <Layers className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
            <p className="terminal-font text-xs text-muted-foreground">
              Too few communities with {MIN_COMMUNITY_N}+ listings for a {m.label.toLowerCase()} ranking here
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-border">
            <ol className="divide-y divide-border/60">{colA.map((r, i) => renderRow(r, i + 1))}</ol>
            <ol className="divide-y divide-border/60 max-lg:border-t max-lg:border-border/60">
              {colB.map((r, i) => renderRow(r, split + i + 1))}
            </ol>
          </div>
          {/* The route returns EVERY qualifying community — the collapsed view is a
              teaser; this answers "where does MY community rank?". */}
          {allRows.length > COLLAPSED_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="terminal-font flex min-h-[36px] w-full items-center justify-center gap-1.5 border-t border-border text-[10px] font-bold uppercase tracking-wider text-cyan-700 transition-colors hover:bg-cyan-500/5 dark:text-cyan-400"
            >
              {expanded ? "Show top 6" : `Show all ${allRows.length} ranked communities`}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </>
      )}

      <p className="terminal-font flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-3.5 py-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
        <span className="normal-case tracking-normal">{METRIC_CAPTION[metric]} Tap a row to see it on the map.</span>
        {!loading && heat && (
          <span>
            {heat.analyzed.toLocaleString()} active listings analyzed · communities with {MIN_COMMUNITY_N}+ shown
          </span>
        )}
      </p>
    </section>
  );
}
