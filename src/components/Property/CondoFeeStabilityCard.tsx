"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BASELINE_INFLATION_24MO } from "@/lib/condo/feeStability";
import type {
  FeeStabilityResult,
  TrendBand,
  Confidence,
} from "@/lib/condo/feeStability";
import { TermTip } from "@/components/ui/TermTip";
import { term } from "@/lib/glossary/terms";

interface CondoFeeStabilityCardProps {
  feeStability: FeeStabilityResult | null | undefined;
}

const psf = (n: number) => `$${n.toFixed(2)}/sqft`;

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  HIGH: "bg-green-100 text-green-800 border-green-300",
  MEDIUM: "bg-yellow-100 text-yellow-800 border-yellow-300",
  LOW: "bg-muted text-muted-foreground border-border",
};

const TREND_STYLES: Record<TrendBand, { text: string; chip: string }> = {
  Stable: { text: "text-green-600", chip: "bg-green-100 text-green-800 border-green-300" },
  Moderate: { text: "text-yellow-600", chip: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  Rising: { text: "text-orange-600", chip: "bg-orange-100 text-orange-800 border-orange-300" },
  Steep: { text: "text-red-600", chip: "bg-red-100 text-red-800 border-red-300" },
};

export default function CondoFeeStabilityCard({
  feeStability,
}: CondoFeeStabilityCardProps) {
  if (!feeStability?.available || !feeStability.area || feeStability.unitFeePsf == null) {
    return null;
  }

  const { unitFeePsf, area, trend } = feeStability;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{term("condoFeeStability").name}</CardTitle>
          <TermTip id="condoFeeStability" iconOnly />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* ── Benchmark: this unit's fee/sqft vs the area ── */}
          <div>
            <p className="text-3xl font-bold text-primary">{psf(unitFeePsf)}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              This unit&apos;s maintenance fee
            </p>
            <AreaPosition
              position={area.position}
              pctVsMedian={area.pctVsMedian}
            />
          </div>

          <PercentileBar
            unit={unitFeePsf}
            p25={area.p25Psf}
            median={area.medianPsf}
            p75={area.p75Psf}
          />

          <p className="text-xs text-muted-foreground">
            Area median {psf(area.medianPsf)}
            {area.cityRegion ? ` in ${area.cityRegion}` : ""} · {area.sampleCount} sold condos
          </p>

          {/* ── Trend: same-building fee trajectory (only when dense enough) ── */}
          {trend && (
            <div className="pt-3 border-t space-y-2">
              <div className="flex items-center justify-between">
                <p className={`text-sm font-semibold ${TREND_STYLES[trend.band].text}`}>
                  {trend.pctChange24mo >= 0 ? "↑" : "↓"} {Math.abs(trend.pctChange24mo).toFixed(2)}% over{" "}
                  {trend.buckets.length >= 2 ? "24 mo" : "the period"} · {trend.band}
                </p>
                <span
                  title={`${trend.confidence} confidence — based on ${trend.sampleCount} sold units across ${trend.buckets.length} half-year periods`}
                  className={`text-xs font-medium px-2 py-0.5 border rounded ${CONFIDENCE_STYLES[trend.confidence]}`}
                >
                  {trend.confidence} CONF.
                </span>
              </div>
              <TrendLineChart buckets={trend.buckets} />
              <p className="text-xs text-muted-foreground">
                This building&apos;s median fee/sqft {trend.pctChange24mo >= 0 ? "rose" : "fell"}{" "}
                {Math.abs(trend.pctChange24mo).toFixed(2)}% over the window —{" "}
                <span className={TREND_STYLES[trend.band].text}>{trend.band}</span> vs the
                {" "}~{BASELINE_INFLATION_24MO}% expected from inflation alone. Confidence reflects the{" "}
                {trend.sampleCount} sold units across {trend.buckets.length} half-years.
              </p>
            </div>
          )}

          {/* ── Caveat: cohort mixes what fees include ── */}
          {area.inclusionsMixed && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Fees here vary in what they include (some bundle heat/hydro/water) — compare with that
              in mind.
            </p>
          )}

          <p className="text-xs text-muted-foreground pt-1 border-t">
            Derived from sold condo data
            {area.cityRegion ? ` in ${area.cityRegion}` : ""}. Our metric — not an MLS or TRREB figure.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AreaPosition({
  position,
  pctVsMedian,
}: {
  position: "below" | "typical" | "above";
  pctVsMedian: number;
}) {
  if (position === "typical") {
    return (
      <p className="text-sm font-medium mt-1 text-muted-foreground">
        In line with the area median
      </p>
    );
  }
  const below = position === "below";
  return (
    <p className={`text-sm font-medium mt-1 ${below ? "text-green-600" : "text-red-600"}`}>
      {below ? "↓" : "↑"} {Math.abs(pctVsMedian).toFixed(2)}% {below ? "below" : "above"} area median
    </p>
  );
}

/** Horizontal track: typical (p25–p75) range band + median tick + this unit's marker. */
function PercentileBar({
  unit,
  p25,
  median,
  p75,
}: {
  unit: number;
  p25: number;
  median: number;
  p75: number;
}) {
  const lo = Math.min(p25, unit);
  const hi = Math.max(p75, unit);
  const span = hi - lo || 1;
  const pad = span * 0.12;
  const domainLo = lo - pad;
  const domainHi = hi + pad;
  const domain = domainHi - domainLo || 1;
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - domainLo) / domain) * 100));

  return (
    <div className="pt-1">
      <div className="relative h-2 rounded-full bg-muted">
        {/* typical range (IQR) */}
        <div
          className="absolute h-2 rounded-full bg-primary/20"
          style={{ left: `${pct(p25)}%`, width: `${Math.max(0, pct(p75) - pct(p25))}%` }}
        />
        {/* median tick */}
        <div
          className="absolute top-[-2px] h-3 w-0.5 bg-muted-foreground"
          style={{ left: `${pct(median)}%` }}
        />
        {/* this unit */}
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow"
          style={{ left: `${pct(unit)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{psf(p25)}</span>
        <span>median</span>
        <span>{psf(p75)}</span>
      </div>
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { period: string; medianPsf: number; n: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  return (
    <div className="rounded border border-border bg-background px-2 py-1 shadow-lg">
      <p className="text-[10px] text-muted-foreground">{b.period}</p>
      <p className="text-xs font-mono font-semibold text-primary">{psf(b.medianPsf)}</p>
      <p className="text-[10px] text-muted-foreground">{b.n} sold</p>
    </div>
  );
}

/**
 * Line chart of the building's median fee/sqft per half-year. The Y domain is
 * padded around the data (not anchored to 0) so a small real change is legible —
 * the axis labels show the true $/sqft scale, so it stays honest.
 */
function TrendLineChart({
  buckets,
}: {
  buckets: { period: string; medianPsf: number; n: number }[];
}) {
  const vals = buckets.map((b) => b.medianPsf);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.4 || 0.05;
  const domain: [number, number] = [Math.max(0, lo - pad), hi + pad];
  const data = buckets.map((b) => ({ ...b, label: b.period.replace(/^\d{2}(\d{2})-/, "'$1-") }));

  return (
    <div className="h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "hsl(215 20% 65%)", fontSize: 9 }}
            tickLine={false}
            axisLine={{ stroke: "hsl(215 28% 17%)" }}
          />
          <YAxis
            width={42}
            domain={domain}
            tickCount={3}
            tick={{ fill: "hsl(215 20% 65%)", fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
          />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: "hsl(215 28% 17%)" }} />
          <Line
            type="monotone"
            dataKey="medianPsf"
            stroke="hsl(189 94% 43%)"
            strokeWidth={2}
            dot={{ fill: "hsl(189 94% 43%)", r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
