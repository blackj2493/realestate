"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface TrendPoint {
  month: string; // YYYY-MM
  medianPrice: number;
  medianPpsf: number | null;
  sales: number;
}

function shortMonth(key: string): string {
  const [y, m] = key.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${names[idx]} '${y.slice(2)}` : key;
}

const fmtPrice = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}K`;

export default function MarketPulse({ location }: { location: string }) {
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setPoints(null);
    setError(false);
    fetch(`/api/market/price-trend?region=${encodeURIComponent(location)}`)
      .then((r) => r.json())
      .then((d) => alive && setPoints(Array.isArray(d.points) ? d.points : []))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [location]);

  return (
    <div className="border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <h3 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-slate-200">
          Market Pulse — {location}
        </h3>
        <span className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
          Median Sold · 24mo
        </span>
      </div>

      <div className="h-56 p-3">
        {points === null && !error && (
          <div className="h-full w-full animate-pulse bg-slate-800/40" />
        )}
        {error && (
          <p className="flex h-full items-center justify-center text-xs text-rose-400">
            Failed to load trend
          </p>
        )}
        {points && points.length === 0 && !error && (
          <p className="flex h-full items-center justify-center text-xs text-slate-500">
            No recent sold data for this area
          </p>
        )}
        {points && points.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={shortMonth}
                tick={{ fill: "#64748b", fontSize: 10 }}
                stroke="#334155"
                minTickGap={24}
              />
              <YAxis
                tickFormatter={fmtPrice}
                tick={{ fill: "#64748b", fontSize: 10 }}
                stroke="#334155"
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: "#0f172a",
                  border: "1px solid #334155",
                  fontSize: 12,
                }}
                labelFormatter={shortMonth}
                formatter={(value) => [`$${Number(value).toLocaleString()}`, "Median price"]}
              />
              <Area
                type="monotone"
                dataKey="medianPrice"
                stroke="#22d3ee"
                strokeWidth={2}
                fill="url(#pulseFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
