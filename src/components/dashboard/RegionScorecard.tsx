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
import { fetchRegionScore, type RegionScore } from "@/lib/dashboard/marketAggregates";
import {
  TEMP,
  YoY,
  Sparkline,
  TemperatureBadge,
  compactPrice,
  orDash,
} from "@/components/dashboard/metricViz";

type SortKey =
  | "region"
  | "medianPrice"
  | "medianPpsf"
  | "activeCount"
  | "monthsOfSupply"
  | "soldToListPct"
  | "medianCapRate"
  | "topCapRate"
  | "stalePct"
  | "temperature";

const GRID =
  "grid-cols-[minmax(130px,1.5fr)_minmax(150px,1.4fr)_minmax(96px,1fr)_minmax(72px,0.8fr)_minmax(92px,0.9fr)_minmax(86px,0.9fr)_minmax(84px,0.9fr)_minmax(80px,0.9fr)_minmax(74px,0.8fr)_minmax(78px,0.8fr)]";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "region", label: "Region", align: "left" },
  { key: "medianPrice", label: "Median Price", align: "right" },
  { key: "medianPpsf", label: "$/Sqft", align: "right" },
  { key: "activeCount", label: "Active", align: "right" },
  { key: "monthsOfSupply", label: "Mo. Supply", align: "right" },
  { key: "soldToListPct", label: "Sold/List", align: "right" },
  { key: "medianCapRate", label: "Med Cap", align: "right" },
  { key: "topCapRate", label: "Top Cap", align: "right" },
  { key: "stalePct", label: "% Stale", align: "right" },
  { key: "temperature", label: "Temp", align: "right" },
];

// Global property-type filter. Keys MUST match src/lib/dashboard/propertyTypes.ts
// (the API resolves them to exact PropertySubType spellings via variantsForKeys).
const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "detached", label: "Detached" },
  { key: "semi", label: "Semi" },
  { key: "town", label: "Town" },
  { key: "condo", label: "Condo" },
];

function sortValue(s: RegionScore, key: SortKey): number | string | null {
  if (key === "region") return s.region.toLowerCase();
  if (key === "temperature") return s.temperature ? TEMP[s.temperature].rank : null;
  return s[key] as number | null;
}

export default function RegionScorecard({ regions }: { regions: string[] }) {
  const [scores, setScores] = useState<RegionScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [propertyType, setPropertyType] = useState("all");

  // Stable dependency so the effect doesn't re-fire on every parent render.
  const regionsKey = regions.join("|");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.allSettled(regions.map((r) => fetchRegionScore(r, propertyType)))
      .then((results) => {
        if (!alive) return;
        setScores(
          results.map((res, i) =>
            res.status === "fulfilled" ? res.value : emptyScore(regions[i])
          )
        );
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsKey, propertyType]);

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

  return (
    <section className="space-y-2">
      <h2 className="terminal-font border-b border-slate-800 pb-2 text-sm font-bold uppercase tracking-widest text-slate-100">
        Region Scorecard <span className="text-slate-500">· {regions.length}</span>
      </h2>

      {/* Global property-type filter — re-runs every region aggregate by type. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">Type</span>
        <div className="flex border border-slate-700">
          {TYPE_FILTERS.map((t) => {
            const active = t.key === propertyType;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setPropertyType(t.key)}
                aria-pressed={active}
                className={`terminal-font border-r border-slate-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors last:border-r-0 ${
                  active
                    ? "bg-cyan-500/20 text-cyan-300"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-800">
        <div className="min-w-[1000px]">
          {/* Header */}
          <div className={`grid ${GRID} border-b border-slate-800 bg-slate-900/60`}>
            {COLUMNS.map((c) => {
              const active = sortKey === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onSort(c.key)}
                  className={`terminal-font flex items-center gap-1 px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors hover:text-cyan-300 ${
                    c.align === "right" ? "justify-end" : "justify-start"
                  } ${active ? "text-cyan-400" : "text-slate-400"}`}
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
                <div key={r} className={`grid ${GRID} border-b border-slate-800/60`}>
                  {COLUMNS.map((c) => (
                    <div key={c.key} className="px-2 py-3">
                      <div className="h-3 w-full animate-pulse rounded bg-slate-800" />
                    </div>
                  ))}
                </div>
              ))
            : sorted.map((s) => (
                <div
                  key={s.region}
                  className={`grid ${GRID} items-center border-b border-slate-800/60 transition-colors hover:bg-slate-900/40`}
                >
                  {/* Region */}
                  <Link
                    href={`/properties?city=${encodeURIComponent(s.region)}`}
                    className="terminal-font flex items-center gap-1 px-2 py-3 text-xs font-semibold text-slate-100 hover:text-cyan-300"
                  >
                    <span className="truncate">{s.region}</span>
                    <ArrowUpRight className="h-3 w-3 shrink-0 text-slate-600" />
                  </Link>

                  {/* Median Price + sparkline + YoY */}
                  <div className="flex flex-col items-end gap-0.5 px-2 py-2">
                    <div className="flex w-full items-center justify-end gap-2">
                      <Sparkline data={s.priceSeries} />
                      <span className="terminal-font text-xs font-semibold text-cyan-400">
                        {orDash(s.medianPrice, compactPrice)}
                      </span>
                    </div>
                    <YoY pct={s.yoyPct} />
                  </div>

                  {/* $/Sqft + YoY */}
                  <div className="flex flex-col items-end gap-0.5 px-2 py-2">
                    <span className="terminal-font text-xs text-slate-200">
                      {orDash(s.medianPpsf, (n) => `$${Math.round(n)}`)}
                    </span>
                    <YoY pct={s.ppsfYoyPct} />
                  </div>

                  <Cell>{orDash(s.activeCount, (n) => n.toLocaleString())}</Cell>
                  <Cell>{orDash(s.monthsOfSupply, (n) => n.toFixed(1))}</Cell>
                  <Cell>{orDash(s.soldToListPct, (n) => `${n.toFixed(1)}%`)}</Cell>
                  <Cell>{orDash(s.medianCapRate, (n) => `${n.toFixed(1)}%`)}</Cell>
                  <Cell>{orDash(s.topCapRate, (n) => `${n.toFixed(1)}%`)}</Cell>
                  <Cell>{orDash(s.stalePct, (n) => `${n.toFixed(0)}%`)}</Cell>

                  {/* Temperature */}
                  <div className="flex justify-end px-2 py-3">
                    <TemperatureBadge temperature={s.temperature} />
                  </div>
                </div>
              ))}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-600">
        {propertyType !== "all" && (
          <span className="text-slate-400">
            Showing: {TYPE_FILTERS.find((t) => t.key === propertyType)?.label}.{" "}
          </span>
        )}
        Active metrics (cap rate, active count, % stale) are full-population over current active inventory.
        Median price, $/sqft, Sold/List & months of supply are from sold records (recent months lag).
        Sold/List shown only where list-price coverage ≥ 50%. Median cap requires ≥ 5 priced active listings.
      </p>
    </section>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div className="terminal-font px-2 py-3 text-right text-xs text-slate-200">{children}</div>
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
