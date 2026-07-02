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

export default function MarketPulse({ location }: { location: string }) {
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  const [metric, setMetric] = useState<Metric>("price");

  useEffect(() => {
    let alive = true;
    setPoints(null);
    setError(false);
    setLocked(false);
    fetch(`/api/market/price-trend?region=${encodeURIComponent(location)}`)
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
  }, [location]);

  const isPrice = metric === "price";
  const lineKey = isPrice ? "medianPrice" : "medianPpsf";
  const lineFmt = isPrice ? fmtPrice : fmtPpsf;

  const yoy = useMemo(
    () => (points && points.length ? smoothedYoY(points, isPrice ? "medianPrice" : "medianPpsf") : null),
    [points, isPrice]
  );

  return (
    <div className="border border-border bg-card/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <h3 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
            Market Pulse — {location}
          </h3>
          {yoy != null && (
            <span
              className={`terminal-font text-[10px] font-bold uppercase tracking-wider ${
                yoy >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
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
                      ? "bg-cyan-500/20 text-cyan-300"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span className="terminal-font hidden text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
            Sold · 24mo
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
          <p className="flex h-full items-center justify-center text-xs text-rose-600 dark:text-rose-400">
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
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={shortMonth}
                tick={{ fill: "#64748b", fontSize: 10 }}
                stroke="#334155"
                minTickGap={24}
              />
              {/* Left axis: price / $sqft */}
              <YAxis
                yAxisId="left"
                tickFormatter={lineFmt}
                tick={{ fill: "#64748b", fontSize: 10 }}
                stroke="#334155"
                width={48}
              />
              {/* Right axis: sold volume */}
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "#475569", fontSize: 10 }}
                stroke="#334155"
                width={32}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }}
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
              <Bar yAxisId="right" dataKey="sales" fill="#1e3a4a" radius={[2, 2, 0, 0]} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey={lineKey}
                stroke="#22d3ee"
                strokeWidth={2}
                dot={false}
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
