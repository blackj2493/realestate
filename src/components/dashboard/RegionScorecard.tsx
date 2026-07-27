"use client";

/**
 * Region Scorecard — a sortable head-to-head comparison of the user's market areas on
 * metrics HouseSigma/Realtor.ca don't surface (months of supply, sold-to-list, market
 * temperature), every one a TRUTHFUL full-population aggregate (see marketAggregates.ts).
 * Aggregates only — no listing rows — so the §6.3(b) display cap doesn't apply.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpRight } from "lucide-react";
import { fetchRegionScores, type RegionScore } from "@/lib/dashboard/marketAggregates";
import type { BasementFilter } from "@/lib/dashboard/config";
import {
  TEMP,
  YoY,
  Sparkline,
  TemperatureBadge,
  compactPrice,
  orDash,
} from "@/components/dashboard/metricViz";
import { cn } from "@/lib/utils";
import VowGateOverlay from "@/components/auth/VowGateOverlay";
import { ModuleHead } from "@/components/daylight/primitives";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";

type SortKey =
  | "region"
  | "medianPrice"
  | "medianPpsf"
  | "activeCount"
  | "monthsOfSupply"
  | "trueDom"
  | "soldToListPct"
  | "sellThroughPct"
  | "medianCapRate"
  | "temperature";

const GRID =
  "grid-cols-[minmax(130px,1.5fr)_minmax(150px,1.4fr)_minmax(84px,0.9fr)_minmax(72px,0.8fr)_minmax(90px,0.9fr)_minmax(96px,1fr)_minmax(84px,0.9fr)_minmax(96px,1fr)_minmax(80px,0.9fr)_minmax(78px,0.8fr)]";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "region", label: "Region", align: "left" },
  { key: "medianPrice", label: "Median Price", align: "right" },
  { key: "medianPpsf", label: "$/Sqft", align: "right" },
  { key: "activeCount", label: "Active", align: "right" },
  { key: "monthsOfSupply", label: "Mo. Supply", align: "right" },
  { key: "trueDom", label: "True DoM", align: "right" },
  { key: "soldToListPct", label: "Sold/List", align: "right" },
  { key: "sellThroughPct", label: "Sell-Thru", align: "right" },
  { key: "medianCapRate", label: "Med Cap", align: "right" },
  { key: "temperature", label: "Temp", align: "right" },
];

function sortValue(s: RegionScore, key: SortKey): number | string | null {
  if (key === "region") return s.region.toLowerCase();
  if (key === "temperature") return s.temperature ? TEMP[s.temperature].rank : null;
  return s[key] as number | null;
}

export default function RegionScorecard({
  regions,
  propertyTypes,
  minBeds = 0,
  minBaths = 0,
  minGarage = 0,
  minFrontage = 0,
  basement = "any",
}: {
  regions: string[];
  /** Global lens property-type keys ([] = all). Drives the sold/active aggregates. */
  propertyTypes: string[];
  /** Global lens beds/baths/parking/frontage floors (0 = no floor). Scope sold + active medians (Phase C). */
  minBeds?: number;
  minBaths?: number;
  minGarage?: number;
  minFrontage?: number;
  /** Global lens basement finish (any = no filter). Scopes sold + active medians (migration 043). */
  basement?: BasementFilter;
}) {
  const [scores, setScores] = useState<RegionScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Stable dependencies so the effect doesn't re-fire on every parent render.
  const regionsKey = regions.join("|");
  const typesKey = [...propertyTypes].sort().join(",");
  const scopeKey = `${minBeds}|${minBaths}|${minGarage}|${minFrontage}|${basement}`;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    // One batched request for all regions (server runs the VOW gate once + fans out the
    // aggregates in parallel), replacing the old N×4 client fetch storm.
    fetchRegionScores(regions, propertyTypes, {
      minBeds,
      minBaths,
      minParking: minGarage,
      minFrontage,
      basement,
    })
      .then((next) => {
        if (alive) setScores(next);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsKey, typesKey, scopeKey]);

  const sorted = useMemo(() => {
    if (!sortKey) return scores;
    const arr = [...scores];
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always last
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [scores, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "region" ? "asc" : "desc");
    }
  };

  if (regions.length === 0) return null;

  // Human-readable list of the active lens filters, for the disclosure footnote.
  const filterParts = [
    propertyTypes.length > 0
      ? `your selected property type${propertyTypes.length > 1 ? "s" : ""}`
      : null,
    minBeds > 0 ? `${minBeds}+ beds` : null,
    minBaths > 0 ? `${minBaths}+ baths` : null,
    minGarage > 0 ? `${minGarage}+ parking` : null,
    minFrontage > 0 ? `${minFrontage}+ ft frontage` : null,
  ].filter(Boolean) as string[];

  // VOW gate: when every row came back locked (anonymous), blur the grid and
  // surface a single sign-in overlay instead of a wall of "—".
  const locked = !loading && scores.length > 0 && scores.every((s) => s.locked);

  return (
    <section className="space-y-2">
      <ModuleHead title="Region Scorecard" count={regions.length} right="full-population · daily sync" />

      {/* Mobile-only affordance: the 1000px table scrolls horizontally; tell the user. */}
      <p className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground md:hidden">
        ← Scroll for more metrics →
      </p>

      {/* `after:` right-edge fade (md:hidden) signals more columns scroll off-screen.
          from-background so the fade matches the page ground in both themes. */}
      <div className="dt-panel dt-reg relative overflow-x-auto border border-border bg-card after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-10 after:bg-gradient-to-l after:from-background after:to-transparent dark:bg-transparent md:after:hidden">
        <div className={cn("min-w-[1000px]", locked && "blur-sm select-none")}>
          {/* Header */}
          <div className={`grid ${GRID} border-b border-border bg-card/60`}>
            {COLUMNS.map((c) => {
              const active = sortKey === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onSort(c.key)}
                  className={`terminal-font flex items-center gap-1 px-2 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors hover:text-cyan-700 dark:hover:text-cyan-300 ${
                    c.align === "right" ? "justify-end" : "justify-start"
                  } ${active ? "text-cyan-700 dark:text-cyan-400" : "text-muted-foreground"}`}
                >
                  {c.label}
                  {active &&
                    (sortDir === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    ))}
                </button>
              );
            })}
          </div>

          {/* Rows */}
          {loading
            ? regions.map((r) => (
                <div key={r} className={`grid ${GRID} border-b border-border/60`}>
                  {COLUMNS.map((c) => (
                    <div key={c.key} className="px-2 py-3">
                      <div className="h-3 w-full animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ))
            : sorted.map((s) => (
                <div
                  key={s.region}
                  className={`grid ${GRID} items-center border-b border-border/60 transition-colors hover:bg-card/40`}
                >
                  {/* Region */}
                  <Link
                    href={`/properties?city=${encodeURIComponent(s.region)}`}
                    className="terminal-font flex items-center gap-1 px-2 py-3 text-[13px] font-semibold text-foreground hover:text-cyan-700 dark:hover:text-cyan-300"
                  >
                    <span className="truncate" title={s.region}>{formatRegionLabel(s.region)}</span>
                    <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </Link>

                  {/* Median Price + sparkline + YoY */}
                  <div className="flex flex-col items-end gap-0.5 px-2 py-2">
                    <div className="flex w-full items-center justify-end gap-2">
                      <Sparkline data={s.priceSeries} />
                      <span className="terminal-font text-[13px] font-bold text-cyan-700 dark:text-cyan-400">
                        {orDash(s.medianPrice, compactPrice)}
                      </span>
                    </div>
                    <YoY pct={s.yoyPct} />
                  </div>

                  {/* $/Sqft + YoY */}
                  <div className="flex flex-col items-end gap-0.5 px-2 py-2">
                    <span className="terminal-font text-[13px] text-foreground">
                      {orDash(s.medianPpsf, (n) => `$${Math.round(n)}`)}
                    </span>
                    <YoY pct={s.ppsfYoyPct} />
                  </div>

                  <Cell>{orDash(s.activeCount, (n) => n.toLocaleString())}</Cell>
                  <Cell>{orDash(s.monthsOfSupply, (n) => n.toFixed(1))}</Cell>

                  {/* True DoM (primary market-pace metric) + % stale, its derivative, folded in */}
                  <div className="flex flex-col items-end gap-0.5 px-2 py-2">
                    <span className="terminal-font text-[13px] text-foreground">{orDash(s.trueDom, (n) => `${n}d`)}</span>
                    {s.stalePct != null && (
                      <span className="terminal-font text-[10px] text-muted-foreground">{s.stalePct.toFixed(0)}% stale</span>
                    )}
                  </div>

                  <Cell>{orDash(s.soldToListPct, (n) => `${n.toFixed(1)}%`)}</Cell>
                  <Cell>{orDash(s.sellThroughPct, (n) => `${Math.round(n)}%`)}</Cell>
                  <Cell>{orDash(s.medianCapRate, (n) => `${n.toFixed(1)}%`)}</Cell>

                  {/* Temperature */}
                  <div className="flex justify-end px-2 py-3">
                    <TemperatureBadge temperature={s.temperature} />
                  </div>
                </div>
              ))}
        </div>
        {locked && <VowGateOverlay message="Sign in to view region market stats" />}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {filterParts.length > 0 && (
          <span className="text-muted-foreground">Filtered to {filterParts.join(", ")}. </span>
        )}
        Active metrics (True DoM, cap rate, active count, % stale) are full-population over current active
        inventory, deduped by property. Median price, $/sqft, Sold/List & months of supply are from sold
        records (recent months lag). Sell-Thru = share of listings that sold vs withdrew, last 12 months.
        Median price, $/sqft, YoY &amp; months of supply need ≥ 10 recent sales (thinner samples are
        composition noise, not a trend). Sold/List needs list-price coverage ≥ 50%; median cap ≥ 5 priced
        active; True DoM ≥ 10 active; Sell-Thru ≥ 30 resolved listings.
      </p>
    </section>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div className="terminal-font px-2 py-3 text-right text-[13px] text-foreground">{children}</div>
  );
}

