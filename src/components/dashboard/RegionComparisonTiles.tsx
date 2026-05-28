"use client";

/**
 * RegionComparisonTiles — replaces the old bare-number RegionStatTiles. For the
 * active persona, surfaces 3 headline metrics per region, and EVERY tile carries a
 * comparison so the value reads good/bad at a glance:
 *   - medianPrice → 12-mo sparkline + YoY
 *   - peer metrics (cap rate, $/sqft, months supply, % stale) → delta vs the median
 *     of the user's OTHER regions (single-region fallback: market temperature)
 *   - soldToList → colored vs the 100%-of-asking threshold
 *
 * Data comes from the SAME fetchRegionScore() the scorecard uses (server-side
 * full-population aggregates, §4-compliant) — no Typesense sampling, no new endpoint.
 * Uses MEDIAN cap rate, never the outlier "top".
 */

import { useEffect, useMemo, useState } from "react";
import { fetchRegionScore, type RegionScore } from "@/lib/dashboard/marketAggregates";
import { PERSONA_DASHBOARD, type HeadlineMetricId } from "@/lib/dashboard/personaDashboard";
import type { PersonaType } from "@/lib/personas/personaConfig";
import {
  Sparkline,
  YoY,
  PeerDelta,
  TemperatureBadge,
  compactPrice,
  DASH,
} from "@/components/dashboard/metricViz";

type Dir = "higherGood" | "lowerGood" | "neutral";
type Kind = "yoySpark" | "peer" | "threshold";

interface TileMetric {
  label: string;
  get: (s: RegionScore) => number | null;
  format: (n: number) => string;
  dir: Dir;
  kind: Kind;
}

const pct1 = (n: number) => `${n.toFixed(1)}%`;
const ppsf = (n: number) => `$${Math.round(n)}`;
const mo = (n: number) => `${n.toFixed(1)} mo`;

// Only RegionScore-backed metrics here. Specialty tiles (carryBurn/priceDrop/
// densityCount) await the Phase 5 fetchRegionStats extension.
const METRICS: Partial<Record<HeadlineMetricId, TileMetric>> = {
  medianPrice: { label: "Median Price", get: (s) => s.medianPrice, format: compactPrice, dir: "neutral", kind: "yoySpark" },
  medianPpsf: { label: "$ / Sqft", get: (s) => s.medianPpsf, format: ppsf, dir: "lowerGood", kind: "peer" },
  medianCapRate: { label: "Median Cap Rate", get: (s) => s.medianCapRate, format: pct1, dir: "higherGood", kind: "peer" },
  monthsSupply: { label: "Months Supply", get: (s) => s.monthsOfSupply, format: mo, dir: "lowerGood", kind: "peer" },
  soldToList: { label: "Sold / List", get: (s) => s.soldToListPct, format: pct1, dir: "neutral", kind: "threshold" },
  pctStale: { label: "% Stale", get: (s) => s.stalePct, format: (n) => `${n.toFixed(0)}%`, dir: "lowerGood", kind: "peer" },
};

const median = (nums: number[]): number | null => {
  if (nums.length === 0) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};

/** Value color for the threshold metric (sold-to-list): seller's vs buyer's market. */
function thresholdValueClass(v: number): string {
  if (v >= 100) return "text-rose-400";
  if (v < 97) return "text-cyan-400";
  return "text-amber-400";
}

function Tile({
  metric,
  score,
  peerMedian,
}: {
  metric: TileMetric;
  score: RegionScore;
  peerMedian: number | null;
}) {
  const value = metric.get(score);
  const valueClass =
    metric.kind === "threshold" && value != null
      ? thresholdValueClass(value)
      : "text-cyan-400";

  return (
    <div className="flex flex-col gap-1 border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
        {metric.label}
      </div>
      <div className={`terminal-font text-lg font-bold ${valueClass}`}>
        {value == null ? DASH : metric.format(value)}
      </div>
      <div className="flex min-h-[16px] items-center">
        {value == null ? null : metric.kind === "yoySpark" ? (
          <div className="flex items-center gap-2">
            <Sparkline data={score.priceSeries} width={64} height={18} />
            <YoY pct={score.yoyPct} />
          </div>
        ) : metric.kind === "threshold" ? (
          <span className="terminal-font text-[10px] text-slate-500">
            {value >= 100 ? "over asking" : "under asking"}
          </span>
        ) : peerMedian != null ? (
          <PeerDelta value={value} peerMedian={peerMedian} format={metric.format} dir={metric.dir} />
        ) : (
          // Single-region fallback — market temperature instead of a peer delta.
          <TemperatureBadge temperature={score.temperature} />
        )}
      </div>
    </div>
  );
}

export default function RegionComparisonTiles({
  regions,
  persona,
}: {
  regions: string[];
  persona: PersonaType;
}) {
  const [scores, setScores] = useState<RegionScore[]>([]);
  const [loading, setLoading] = useState(true);

  const regionsKey = regions.join("|");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.allSettled(regions.map((r) => fetchRegionScore(r)))
      .then((results) => {
        if (!alive) return;
        setScores(
          results.flatMap((res) => (res.status === "fulfilled" ? [res.value] : []))
        );
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsKey]);

  const metricIds = PERSONA_DASHBOARD[persona].headlineMetrics.filter(
    (id): id is HeadlineMetricId => METRICS[id] != null
  );

  // Peer median per metric, computed across all loaded regions (excluded per-tile).
  const peerValues = useMemo(() => {
    const map: Partial<Record<HeadlineMetricId, number[]>> = {};
    for (const id of metricIds) {
      const m = METRICS[id]!;
      map[id] = scores
        .map((s) => m.get(s))
        .filter((v): v is number => v != null);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, regionsKey, persona]);

  if (regions.length === 0) return null;

  if (loading) {
    return (
      <div className="space-y-3">
        {regions.map((r) => (
          <div key={r} className="grid grid-cols-3 gap-3">
            {metricIds.map((id) => (
              <div key={id} className="h-[88px] animate-pulse border border-slate-800 bg-slate-900/40" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {scores.map((score) => (
        <div key={score.region} className="space-y-1.5">
          {regions.length > 1 && (
            <div className="terminal-font text-[11px] uppercase tracking-wider text-slate-400">
              {score.region}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {metricIds.map((id) => {
              const m = METRICS[id]!;
              const all = peerValues[id] ?? [];
              const own = m.get(score);
              // Peer median EXCLUDING this region's own value.
              const peers = own == null ? all : removeOnce(all, own);
              return (
                <Tile key={id} metric={m} score={score} peerMedian={median(peers)} />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function removeOnce(arr: number[], v: number): number[] {
  const i = arr.indexOf(v);
  if (i === -1) return arr;
  return [...arr.slice(0, i), ...arr.slice(i + 1)];
}
