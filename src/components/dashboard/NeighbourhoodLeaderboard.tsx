"use client";

/**
 * Neighbourhood Heat, leaderboard edition — replaces the decorative 3D hexbin tile
 * (owner call 2026-07-24: non-interactive unlabeled columns couldn't answer "WHICH
 * pocket is hot"). Ranks the selected region's communities (CityRegion) by a
 * toggleable metric — median over the same ≤100-active sample the old tile drew
 * (TRREB §6.3(b) UI cap), with the ×n honesty count — and every row deep-links
 * into the Map Terminal centered on that community's listings, so the tile is an
 * entry point to action, not decoration. No WebGL: readable on mobile and drops
 * the deck.gl bundle from the dashboard.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Layers } from "lucide-react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { locationFilter } from "@/lib/dashboard/queries";
import { capRateOrNull } from "@/lib/metrics/sanityBand";
import { isValidLocation } from "@/components/Map/mapLogic";
import RegionSwitcher from "./RegionSwitcher";

type MetricId = "cap" | "dom" | "drop";

const METRICS: {
  id: MetricId;
  label: string;
  get: (d: ListingDocument) => number | undefined;
  fmt: (v: number) => string;
}[] = [
  { id: "cap", label: "Cap Rate", get: (d) => capRateOrNull(d.cap_rate_est) ?? undefined, fmt: (v) => `${v.toFixed(1)}%` },
  { id: "dom", label: "True DOM", get: (d) => d.TrueDom, fmt: (v) => `${Math.round(v)}d` },
  {
    id: "drop",
    label: "Price Drop",
    get: (d) => d.TotalPriceDrop,
    fmt: (v) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1000)}k`),
  },
];

const METRIC_CAPTION: Record<MetricId, string> = {
  cap: "Communities where active listings show the highest cap rates (rental yield).",
  dom: "Communities where active listings have sat on the market the longest.",
  drop: "Communities where sellers have made the deepest price cuts.",
};

const MAX_ROWS = 6;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

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

interface Row {
  name: string;
  median: number;
  count: number;
  lat: number;
  lng: number;
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
  const [metric, setMetric] = useState<MetricId>("cap");
  const [listings, setListings] = useState<ListingDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    searchListings({ query: "*", rawFilterBy: locationFilter(selected), perPage: 100 })
      .then((res) => {
        if (alive) setListings(res.listings.filter((l) => isValidLocation(l.location)));
      })
      .catch(() => alive && setListings([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [selected]);

  const m = METRICS.find((x) => x.id === metric)!;

  const rows = useMemo<Row[]>(() => {
    const groups = new Map<string, { values: number[]; latSum: number; lngSum: number }>();
    for (const l of listings) {
      const name = (l.CityRegion || "").trim();
      const v = m.get(l);
      if (!name || v == null || !Number.isFinite(v) || v <= 0) continue;
      const g = groups.get(name) ?? { values: [], latSum: 0, lngSum: 0 };
      g.values.push(v);
      g.latSum += l.location[0];
      g.lngSum += l.location[1];
      groups.set(name, g);
    }
    return [...groups.entries()]
      .map(([name, g]) => ({
        name,
        median: median(g.values),
        count: g.values.length,
        lat: g.latSum / g.values.length,
        lng: g.lngSum / g.values.length,
      }))
      .sort((a, b) => b.median - a.median)
      .slice(0, MAX_ROWS);
  }, [listings, m]);

  const maxMedian = rows.length ? rows[0].median : 1;
  const sampled = useMemo(
    () => listings.reduce((n, l) => (m.get(l) != null && (m.get(l) as number) > 0 && (l.CityRegion || "").trim() ? n + 1 : n), 0),
    [listings, m]
  );
  const mapUrl = `/properties?city=${encodeURIComponent(selected)}`;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-foreground">
            Neighbourhood Heat
          </h2>
          {regions.length > 1 ? (
            <RegionSwitcher regions={regions} selected={selected} onSelect={onSelect} />
          ) : (
            <span className="terminal-font text-sm font-bold uppercase tracking-widest text-muted-foreground">
              · {selected}
            </span>
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

      <p className="text-[11px] leading-snug text-muted-foreground">
        {METRIC_CAPTION[metric]} Median per community over a sample of up to 100 active listings
        (×n = listings behind each figure). Tap a row to see it on the map.
      </p>

      <div className="border border-border bg-card dark:bg-card/40">
        {loading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 animate-pulse bg-muted/40" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-center">
            <div>
              <Layers className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="terminal-font text-xs text-muted-foreground">
                No {m.label.toLowerCase()} data by community here
              </p>
            </div>
          </div>
        ) : (
          <ol className="divide-y divide-border">
            {rows.map((r, i) => (
              <li key={r.name}>
                <Link
                  href={`/properties?lat=${r.lat.toFixed(6)}&lng=${r.lng.toFixed(6)}&z=14`}
                  className="group block px-3.5 py-2.5 transition-colors hover:bg-cyan-500/5"
                >
                  <span className="flex items-baseline gap-2.5">
                    <span className="terminal-font w-4 shrink-0 text-right text-[10px] font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-cyan-700 dark:group-hover:text-cyan-300">
                      {displayName(r.name, selected)}
                    </span>
                    <span className="terminal-font shrink-0 font-mono text-sm font-bold tabular-nums text-foreground">
                      {m.fmt(r.median)}
                    </span>
                    <span className="terminal-font shrink-0 font-mono text-[10px] text-muted-foreground">
                      ×{r.count}
                    </span>
                  </span>
                  <span className="mt-1.5 ml-[26px] block h-1.5 rounded-sm bg-muted/40">
                    <span
                      className="block h-full rounded-sm bg-gradient-to-r from-cyan-600/70 to-cyan-400/80 dark:from-cyan-500/50 dark:to-cyan-300/70"
                      style={{ width: `${Math.max(6, (r.median / maxMedian) * 100)}%` }}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
        {!loading && rows.length > 0 && (
          <p className="terminal-font border-t border-border px-3.5 py-1.5 text-right text-[9px] uppercase tracking-wider text-muted-foreground">
            {sampled} of up to 100 active in sample
          </p>
        )}
      </div>
    </section>
  );
}
