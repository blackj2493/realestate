"use client";

/**
 * RegionComparisonTiles — replaces the old bare-number RegionStatTiles. For the
 * active persona, surfaces 3 headline metrics per region, and EVERY tile carries a
 * comparison so the value reads good/bad at a glance:
 *   - medianPrice → 12-mo sparkline + YoY
 *   - peer metrics (cap rate, $/sqft, months supply, % stale, specialty shares) →
 *     delta vs the median of the user's OTHER regions (single-region fallback:
 *     market temperature)
 *   - soldToList → colored vs the 100%-of-asking threshold
 *
 * Two backing sources, both §4-compliant full-population aggregates (no Typesense
 * 100-row sampling): fetchRegionScore() (server-side, sold+active stats) and
 * fetchRegionSpecialty() (Typesense counts → share of active inventory). Specialty
 * shares are only fetched when the active persona actually surfaces one, so the
 * default "smart" persona fires no extra queries. Uses MEDIAN cap rate, never the
 * outlier "top".
 */

import { useEffect, useMemo, useState } from "react";
import { fetchRegionScore, type RegionScore } from "@/lib/dashboard/marketAggregates";
import {
  fetchRegionSpecialty,
  type RegionSpecialtyStats,
  CASHFLOW_CAP_FLOOR,
} from "@/lib/dashboard/queries";
import { regionArea } from "@/lib/dashboard/area";
import { scopeKey } from "@/lib/dashboard/lensKey";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import {
  PERSONA_DASHBOARD,
  SPECIALTY_METRIC_IDS,
  type HeadlineMetricId,
} from "@/lib/dashboard/personaDashboard";
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

/** Combined per-region payload — RegionScore is always present; specialty is fetched
 *  only when the active persona surfaces a share metric (else null). */
interface RegionData {
  score: RegionScore;
  specialty: RegionSpecialtyStats | null;
}

interface TileMetric {
  label: string;
  get: (d: RegionData) => number | null;
  format: (n: number) => string;
  /** Optional secondary line under the comparison (e.g. the raw count behind a share). */
  sub?: (d: RegionData) => string | null;
  dir: Dir;
  kind: Kind;
}

const SPECIALTY = new Set<HeadlineMetricId>(SPECIALTY_METRIC_IDS);

const pct1 = (n: number) => `${n.toFixed(1)}%`;
const ppsf = (n: number) => `$${Math.round(n)}`;
const mo = (n: number) => `${n.toFixed(1)} mo`;

/** Share of active inventory matching a count (null when there's no active inventory). */
const share = (count: number, active: number): number | null =>
  active > 0 ? (count / active) * 100 : null;

const METRICS: Partial<Record<HeadlineMetricId, TileMetric>> = {
  // ── RegionScore-backed ──
  medianPrice: { label: "Median Price", get: (d) => d.score.medianPrice, format: compactPrice, dir: "neutral", kind: "yoySpark" },
  medianPpsf: { label: "$ / Sqft", get: (d) => d.score.medianPpsf, format: ppsf, dir: "lowerGood", kind: "peer" },
  medianCapRate: { label: "Median Cap Rate", get: (d) => d.score.medianCapRate, format: pct1, dir: "higherGood", kind: "peer" },
  monthsSupply: { label: "Months Supply", get: (d) => d.score.monthsOfSupply, format: mo, dir: "lowerGood", kind: "peer" },
  soldToList: { label: "Sold / List", get: (d) => d.score.soldToListPct, format: pct1, dir: "neutral", kind: "threshold" },
  pctStale: { label: "% Stale", get: (d) => d.score.stalePct, format: (n) => `${n.toFixed(0)}%`, dir: "lowerGood", kind: "peer" },

  // ── Specialty inventory shares (fetchRegionSpecialty) ──
  cashflowShare: {
    label: "Cashflow-Grade",
    get: (d) => (d.specialty ? share(d.specialty.cashflowCount, d.specialty.activeCount) : null),
    format: pct1,
    sub: (d) => (d.specialty ? `${d.specialty.cashflowCount.toLocaleString()} ≥${CASHFLOW_CAP_FLOOR}% cap` : null),
    dir: "higherGood",
    kind: "peer",
  },
  priceCutShare: {
    label: "Price-Cut Share",
    get: (d) => (d.specialty ? share(d.specialty.priceCutCount, d.specialty.activeCount) : null),
    format: pct1,
    sub: (d) => (d.specialty ? `${d.specialty.priceCutCount.toLocaleString()} reduced` : null),
    dir: "higherGood",
    kind: "peer",
  },
  densityShare: {
    label: "Density-Ready",
    get: (d) => (d.specialty ? share(d.specialty.densityReadyCount, d.specialty.activeCount) : null),
    format: pct1,
    sub: (d) => (d.specialty ? `${d.specialty.densityReadyCount.toLocaleString()} lots` : null),
    dir: "higherGood",
    kind: "peer",
  },
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
  data,
  peerMedian,
}: {
  metric: TileMetric;
  data: RegionData;
  peerMedian: number | null;
}) {
  const value = metric.get(data);
  const valueClass =
    metric.kind === "threshold" && value != null
      ? thresholdValueClass(value)
      : "text-cyan-400";
  const sub = value != null ? metric.sub?.(data) ?? null : null;

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
            <Sparkline data={data.score.priceSeries} width={64} height={18} />
            <YoY pct={data.score.yoyPct} />
          </div>
        ) : metric.kind === "threshold" ? (
          <span className="terminal-font text-[10px] text-slate-500">
            {value >= 100 ? "over asking" : "under asking"}
          </span>
        ) : peerMedian != null ? (
          <PeerDelta value={value} peerMedian={peerMedian} format={metric.format} dir={metric.dir} />
        ) : (
          // Single-region fallback — market temperature instead of a peer delta.
          <TemperatureBadge temperature={data.score.temperature} />
        )}
      </div>
      {sub && (
        <div className="terminal-font text-[9px] uppercase tracking-wider text-slate-600">
          {sub}
        </div>
      )}
    </div>
  );
}

export default function RegionComparisonTiles({
  regions,
  persona,
  lens,
}: {
  regions: string[];
  persona: PersonaType;
  lens: MarketActivityLens;
}) {
  const [datas, setDatas] = useState<RegionData[]>([]);
  const [loading, setLoading] = useState(true);

  const metricIds = PERSONA_DASHBOARD[persona].headlineMetrics.filter(
    (id): id is HeadlineMetricId => METRICS[id] != null
  );

  const regionsKey = regions.join("|");
  const scope = scopeKey(lens);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Only pay for the specialty count queries when a share metric is on screen.
    const needSpecialty = PERSONA_DASHBOARD[persona].headlineMetrics.some((id) =>
      SPECIALTY.has(id)
    );
    Promise.allSettled(
      regions.map(async (r): Promise<RegionData> => {
        const [score, specialty] = await Promise.all([
          // Server medians honor the full lens slice — property type (Phase B) and the
          // beds/baths/parking/frontage floors (Phase C) — same slice as the boards &
          // specialty counts.
          fetchRegionScore(r, lens.propertyTypes, {
            minBeds: lens.minBeds,
            minBaths: lens.minBaths,
            minParking: lens.minGarage,
            minFrontage: lens.minFrontage,
          }),
          // Specialty shares honor the full scope incl. sale/lease + beds/baths.
          needSpecialty
            ? fetchRegionSpecialty(regionArea(r), lens).catch(() => null)
            : Promise.resolve(null),
        ]);
        return { score, specialty };
      })
    )
      .then((results) => {
        if (!alive) return;
        setDatas(
          results.flatMap((res) => (res.status === "fulfilled" ? [res.value] : []))
        );
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsKey, persona, scope]);

  // Peer median per metric, computed across all loaded regions (excluded per-tile).
  const peerValues = useMemo(() => {
    const map: Partial<Record<HeadlineMetricId, number[]>> = {};
    for (const id of metricIds) {
      const m = METRICS[id]!;
      map[id] = datas
        .map((d) => m.get(d))
        .filter((v): v is number => v != null);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datas, regionsKey, persona]);

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
      {datas.map((d) => (
        <div key={d.score.region} className="space-y-1.5">
          {regions.length > 1 && (
            <div className="terminal-font text-[11px] uppercase tracking-wider text-slate-400">
              {d.score.region}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {metricIds.map((id) => {
              const m = METRICS[id]!;
              const all = peerValues[id] ?? [];
              const own = m.get(d);
              // Peer median EXCLUDING this region's own value.
              const peers = own == null ? all : removeOnce(all, own);
              return (
                <Tile key={id} metric={m} data={d} peerMedian={median(peers)} />
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
