"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  FeeStabilityResult,
  TrendBand,
  Confidence,
} from "@/lib/condo/feeStability";

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
        <CardTitle>Condo Fee Stability</CardTitle>
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
                  {trend.pctChange24mo >= 0 ? "↑" : "↓"} {Math.abs(trend.pctChange24mo)}% over{" "}
                  {trend.buckets.length >= 2 ? "24 mo" : "the period"} · {trend.band}
                </p>
                <span
                  className={`text-xs font-medium px-2 py-0.5 border rounded ${CONFIDENCE_STYLES[trend.confidence]}`}
                >
                  {trend.confidence}
                </span>
              </div>
              <TrendBars buckets={trend.buckets} />
              <p className="text-xs text-muted-foreground">
                Median fee/sqft for this building, {trend.sampleCount} sold units.
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
      {below ? "↓" : "↑"} {Math.abs(pctVsMedian)}% {below ? "below" : "above"} area median
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

function TrendBars({
  buckets,
}: {
  buckets: { period: string; medianPsf: number; n: number }[];
}) {
  const max = Math.max(...buckets.map((b) => b.medianPsf), 0.0001);
  return (
    <div className="flex items-end gap-1 h-16">
      {buckets.map((b) => (
        <div key={b.period} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-primary/70"
            style={{ height: `${Math.max(6, (b.medianPsf / max) * 100)}%` }}
            title={`${b.period}: ${psf(b.medianPsf)} (${b.n})`}
          />
          <span className="text-[9px] text-muted-foreground leading-none">
            {b.period.replace("-", "‑")}
          </span>
        </div>
      ))}
    </div>
  );
}
