"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { smoothedYoY } from "@/lib/dashboard/marketAggregates";
import VowGateOverlay from "@/components/auth/VowGateOverlay";
import { useChartTheme } from "@/lib/theme/useChartTheme";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";
import RegionSwitcher from "./RegionSwitcher";

interface TrendPoint {
  month: string; // YYYY-MM
  medianPrice: number;
  medianPpsf: number | null;
  sales: number;
}

type Metric = "price" | "ppsf";

function shortMonth(key: string): string {
  const [y, m] = key.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${names[idx]} '${y.slice(2)}` : key;
}

const fmtPrice = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}K`;
const fmtPpsf = (v: number) => `$${Math.round(v)}`;

export default function MarketPulse({
  regions,
  selected,
  onSelect,
}: {
  regions: string[];
  selected: string;
  onSelect: (region: string) => void;
}) {
  const chart = useChartTheme();
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  const [metric, setMetric] = useState<Metric>("price");

  useEffect(() => {
    let alive = true;
    setPoints(null);
    setError(false);
    setLocked(false);
    fetch(`/api/market/price-trend?region=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setLocked(!!d.locked);
        setPoints(Array.isArray(d.points) ? d.points : []);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [selected]);

  const isPrice = metric === "price";
  const lineKey = isPrice ? "medianPrice" : "medianPpsf";
  const lineFmt = isPrice ? fmtPrice : fmtPpsf;

  const yoy = useMemo(
    () => (points && points.length ? smoothedYoY(points, isPrice ? "medianPrice" : "medianPpsf") : null),
    [points, isPrice]
  );

  return (
    <div className="dt-panel dt-reg border border-border bg-card dark:bg-card/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
            Market Pulse{regions.length > 1 ? "" : ` — ${formatRegionLabel(selected)}`}
          </h3>
          {regions.length > 1 && (
            <RegionSwitcher regions={regions} selected={selected} onSelect={onSelect} />
          )}
          {yoy != null && (
            <span
              className={`terminal-font text-[10px] font-bold uppercase tracking-wider ${
                yoy >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
              }`}
            >
              {yoy >= 0 ? "▲" : "▼"} {Math.abs(yoy).toFixed(1)}% YoY
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border">
            {([
              ["price", "Median Price"],
              ["ppsf", "$ / Sqft"],
            ] as [Metric, string][]).map(([id, label]) => {
              const active = id === metric;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMetric(id)}
                  aria-pressed={active}
                  className={`terminal-font border-r border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors last:border-r-0 ${
                    active
                      ? "bg-[color:var(--dt-sig)] text-white dark:bg-cyan-500/20 dark:text-cyan-300"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {/* Micro-legend — nothing else tells a viewer which axis belongs to what. */}
          <span className="terminal-font hidden items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground sm:flex">
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-4 rounded" style={{ background: chart.line }} />
              {isPrice ? "Median" : "$/sqft"}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2 rounded-sm" style={{ background: chart.bar, opacity: 0.55 }} />
              Sales
            </span>
            <span>· 24mo</span>
          </span>
        </div>
      </div>

      <div className="relative h-56 p-3">
        {locked && (
          <div className="relative h-full w-full">
            <div
              className="h-full w-full rounded bg-gradient-to-t from-slate-800/50 to-slate-900/10 blur-sm"
              aria-hidden="true"
            />
            <VowGateOverlay message="Sign in to view sold-price trends" />
          </div>
        )}
        {!locked && points === null && !error && (
          <div className="h-full w-full animate-pulse bg-muted/40" />
        )}
        {!locked && error && (
          <p className="flex h-full items-center justify-center text-xs text-rose-700 dark:text-rose-400">
            Failed to load trend
          </p>
        )}
        {!locked && points && points.length === 0 && !error && (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No recent sold data for this area
          </p>
        )}
        {!locked && points && points.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={shortMonth}
                tick={{ fill: chart.axisText, fontSize: 10 }}
                stroke={chart.axisLine}
                minTickGap={24}
              />
              {/* Left axis: price / $sqft — scaled to the DATA, not zero-based, so a
                  few-percent move actually has a visible shape (a zero-based axis
                  rendered a 3.7% YoY decline as a flat line). */}
              <YAxis
                yAxisId="left"
                tickFormatter={lineFmt}
                tick={{ fill: chart.axisText, fontSize: 10 }}
                stroke={chart.axisLine}
                width={48}
                domain={[
                  (dataMin: number) => Math.floor(dataMin * 0.96),
                  (dataMax: number) => Math.ceil(dataMax * 1.02),
                ]}
              />
              {/* Right axis: sold volume. Headroom (×1.5) keeps the bars in the lower
                  band so they read as context under the price line, not the headline. */}
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: chart.axisText, fontSize: 10 }}
                stroke={chart.axisLine}
                width={32}
                allowDecimals={false}
                domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.5)]}
              />
              <Tooltip
                contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, fontSize: 12 }}
                labelFormatter={shortMonth}
                formatter={(value, name) => {
                  if (name === "sales") return [`${Number(value).toLocaleString()}`, "Sales"];
                  if (value == null) return ["—", isPrice ? "Median price" : "Median $/sqft"];
                  return [
                    `$${Number(value).toLocaleString()}`,
                    isPrice ? "Median price" : "Median $/sqft",
                  ];
                }}
              />
              <Bar yAxisId="right" dataKey="sales" fill={chart.bar} fillOpacity={0.55} radius={[2, 2, 0, 0]} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey={lineKey}
                stroke={chart.line}
                strokeWidth={2}
                // Teal "live" dot + printed value on the latest plotted point — the
                // endpoint is the number the whole chart exists to deliver.
                dot={(p: { cx?: number; cy?: number; index?: number; key?: string; value?: number }) =>
                  p.cx == null || p.cy == null || p.index !== points.length - 1 ? (
                    <g key={p.key ?? p.index} />
                  ) : (
                    <g key={p.key ?? p.index}>
                      <circle cx={p.cx} cy={p.cy} r={4} fill={chart.endpoint} stroke={chart.surface} strokeWidth={1.6} />
                      {p.value != null && (
                        <text
                          x={p.cx - 9}
                          y={p.cy - 9}
                          textAnchor="end"
                          fill={chart.endpoint}
                          fontSize={11}
                          fontWeight={700}
                          fontFamily="ui-monospace, monospace"
                        >
                          {lineFmt(p.value)}
                        </text>
                      )}
                    </g>
                  )
                }
                connectNulls={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
