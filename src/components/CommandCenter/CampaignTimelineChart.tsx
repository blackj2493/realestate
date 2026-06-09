/**
 * CampaignTimelineChart — the price-graph HERO for a property's full sale history.
 * Stepped sale-price line across campaigns with off-market GAPS (line breaks),
 * the current stitched-campaign window SHADED (the part counted toward True DOM),
 * event markers, and a lease lane. Fed by buildSaleChartSeries (already gated:
 * events are [] for anon, so this renders nothing for them — the page shows the
 * CampaignHistorySection teaser instead).
 */
"use client";

import React from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceDot,
} from "recharts";
import { Activity } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { buildSaleChartSeries } from "@/lib/campaignHistory/timeline";
import type { CampaignEvent } from "@/lib/campaignHistory/types";

function fmtMonthYear(t: number): string {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

const MARKER_FILL: Record<string, string> = {
  "Listed for Sale": "#10b981", "Price Changed": "#f59e0b",
  Terminated: "#f43f5e", Expired: "#64748b", Sold: "#fbbf24",
};

export default function CampaignTimelineChart({
  events, trueDom, campaignCount, className,
}: {
  events: CampaignEvent[];
  trueDom: number | null;
  campaignCount: number;
  className?: string;
}) {
  // eslint-disable-next-line react-hooks/purity -- nowMs is a stable snapshot; chart only re-computes when events change
  const series = React.useMemo(() => buildSaleChartSeries(events, { nowMs: Date.now() }), [events]);
  if (series.points.length === 0) return null;

  const data = series.points.map((p) => ({ t: p.t, price: p.price }));

  return (
    <div className={cn("rounded-lg border border-slate-800 bg-slate-900/50 p-4", className)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">Price &amp; Listing Timeline</span>
        </div>
        <span className="text-xs text-slate-500">
          Listed {campaignCount}×{trueDom != null ? ` · True DOM ${trueDom}d` : ""}
        </span>
      </div>

      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
              tickFormatter={fmtMonthYear} tick={{ fill: "#64748b", fontSize: 10 }}
              tickLine={{ stroke: "#334155" }} axisLine={{ stroke: "#334155" }} />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={{ stroke: "#334155" }}
              axisLine={{ stroke: "#334155" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              domain={["dataMin - 50000", "dataMax + 50000"]} />
            <Tooltip
              labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              formatter={(v: number) => [v ? formatPrice(v) : "—", "List price"]}
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 12 }} />
            {series.stitchStartT != null && series.stitchEndT != null && (
              <ReferenceArea x1={series.stitchStartT} x2={series.stitchEndT} fill="#0891b2" fillOpacity={0.12}
                stroke="#0891b2" strokeOpacity={0.3} />
            )}
            <Line type="stepAfter" dataKey="price" stroke="#94a3b8" strokeWidth={2} dot={false}
              connectNulls={false} isAnimationActive={false} />
            {series.markers.map((m, i) => (
              <ReferenceDot key={i} x={m.t} y={m.price} r={4}
                fill={MARKER_FILL[m.kind] ?? "#94a3b8"} stroke="#0f172a" strokeWidth={1} isFront />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "#10b981" }} />Listed</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "#f59e0b" }} />Price change</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "#f43f5e" }} />Off-market</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: "#0891b2", opacity: 0.4 }} />Current campaign (True DOM)</span>
        {series.leasePeriods.length > 0 && <span className="text-sky-400">{series.leasePeriods.length} lease period{series.leasePeriods.length > 1 ? "s" : ""}</span>}
      </div>
    </div>
  );
}
