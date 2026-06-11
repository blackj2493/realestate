"use client";

/**
 * ExpectedSaleCard — the list-AWARE "what will this close at?" number, the companion to
 * the list-blind PureProperty Estimate (ListingEstimateCard). Shows the Expected Sale
 * Price + an honest range, the delta vs ask, the market-temperature line, and a "how it
 * lines up" axis that places asking, expected sale, and the comparable-value range
 * (the AVM band) on one track — resolving how the two numbers relate.
 *
 * VOW-derived (the close/list ratio comes from raw_vow_sold) → renders a blurred
 * "Login Required" teaser for anonymous users; the real value is never in their DOM
 * (the server nulls `expectedSale` via gateVowDerived). Mirrors ListingEstimateCard.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { AVMResult } from "@/lib/avm/types";
import { axisPosition, lineupDomain, type ExpectedSale } from "@/lib/avm/expectedSale";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

interface ExpectedSaleCardProps {
  expectedSale: ExpectedSale | null;
  /** The list-blind AVM — used only to draw the comparable-value range on the lineup. */
  estimate: AVMResult | null;
  listPrice: number;
  city?: string;
  propertySubType?: string;
  /** VOW gate: the ratio is VOW-derived — render a blurred teaser for anon. */
  locked?: boolean;
}

export default function ExpectedSaleCard({
  expectedSale,
  estimate,
  listPrice,
  city,
  propertySubType,
  locked,
}: ExpectedSaleCardProps) {
  if (locked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Expected Sale Price</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <div className="space-y-2 blur-sm select-none" aria-hidden="true">
              <p className="text-3xl font-bold text-primary">$0,000,000</p>
              <p className="text-xs font-mono text-muted-foreground">Likely range $000K – $000K</p>
              <p className="text-sm font-medium text-muted-foreground">≈ $00,000 below ask</p>
            </div>
            <VowGateOverlay message="Sign in to see what this home will likely close at" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Only the Expected-Sale-specific number gates this card; when there aren't enough
  // recent sold/ask pairs to trust a ratio, we render nothing (the AVM card still shows).
  if (!expectedSale || !(listPrice > 0)) return null;

  const { expectedPrice, lowBand, highBand, ratio, sampleSize, scope, deltaVsAskPct } = expectedSale;
  const below = deltaVsAskPct < 0;
  const deltaAbs = Math.abs(expectedPrice - listPrice);
  const deltaPctStr = `${below ? "" : "+"}${(deltaVsAskPct * 100).toFixed(1)}%`;
  const ratioOfAsk = (ratio * 100).toFixed(1); // e.g. "96.5"
  const where =
    scope === "cohort"
      ? `${propertySubType ?? "Homes"} in ${city ?? "this market"}`
      : (city ?? "This market");

  // ── "How it lines up" axis ──────────────────────────────────────────────────
  const compLo = estimate && estimate.lowBand > 0 ? estimate.lowBand : null;
  const compHi = estimate && estimate.highBand > 0 ? estimate.highBand : null;
  const compMid = estimate && estimate.estimatedValue > 0 ? estimate.estimatedValue : null;
  const hasComp = compLo !== null && compHi !== null && compHi > compLo;

  const domain = lineupDomain([compLo ?? 0, compHi ?? 0, listPrice, expectedPrice]);
  const pos = (v: number | null) => (v === null ? null : axisPosition(v, domain.min, domain.max) * 100);
  const askPos = pos(listPrice)!;
  const expPos = pos(expectedPrice)!;
  const loPos = pos(compLo);
  const hiPos = pos(compHi);
  const midPos = pos(compMid);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expected Sale Price</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Hero number + range + delta */}
          <div>
            <p className="text-3xl font-bold text-primary">{formatPrice(expectedPrice)}</p>
            <p className="mt-1 text-xs font-mono text-muted-foreground">
              Likely range {formatPrice(lowBand)} – {formatPrice(highBand)}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-300">
              ≈ {formatPrice(deltaAbs)} ({deltaPctStr}) {below ? "below" : "above"} ask
              {below ? " · room to negotiate" : ""}
            </p>
          </div>

          {/* Market-temperature line */}
          <p className="text-xs text-muted-foreground">
            {where} are closing at{" "}
            <span className="font-mono text-slate-300">~{ratioOfAsk}% of ask</span> right now
            {" "}({sampleSize} recent {scope === "cohort" ? "comparable " : ""}sales, trailing{" "}
            {expectedSale.windowMonths} mo).
          </p>

          {/* "How it lines up" axis: comparable value range + ask + expected on one track */}
          <div className="pt-1">
            <p className="mb-2 text-[10px] font-mono uppercase tracking-wider text-slate-500">
              How it lines up
            </p>
            <div className="relative h-9">
              {/* baseline track */}
              <div className="absolute left-0 right-0 top-4 h-1.5 rounded-full bg-slate-800" />
              {/* comparable-value range segment (the AVM band) */}
              {hasComp && loPos !== null && hiPos !== null && (
                <div
                  className="absolute top-4 h-1.5 rounded-full bg-slate-600"
                  style={{ left: `${loPos}%`, width: `${Math.max(0, hiPos - loPos)}%` }}
                  title="Comparable value range"
                />
              )}
              {/* comparable-value midpoint (AVM) */}
              {midPos !== null && (
                <div
                  className="absolute top-[12px] h-3 w-0.5 -translate-x-1/2 bg-slate-400"
                  style={{ left: `${midPos}%` }}
                  title="Comparable value (mid)"
                />
              )}
              {/* asking marker (▲, above the track) */}
              <div
                className="absolute top-0 -translate-x-1/2 text-[9px] leading-none text-amber-400"
                style={{ left: `${askPos}%` }}
                title="Asking price"
              >
                ▲
              </div>
              {/* expected-sale marker (◆, on the track) */}
              <div
                className="absolute top-[11px] -translate-x-1/2 text-[11px] leading-none text-emerald-400"
                style={{ left: `${expPos}%` }}
                title="Expected sale price"
              >
                ◆
              </div>
            </div>

            {/* legend with exact numbers (avoids label collision on the narrow rail) */}
            <ul className="mt-1.5 space-y-1 text-[11px]">
              {hasComp && (
                <li className="flex items-center justify-between">
                  <span className="text-slate-400">
                    <span className="text-slate-400">▬</span> Comparable value
                  </span>
                  <span className="font-mono text-slate-300">
                    {formatPrice(compLo!)} – {formatPrice(compHi!)}
                  </span>
                </li>
              )}
              <li className="flex items-center justify-between">
                <span className="text-amber-400">▲ Asking</span>
                <span className="font-mono text-slate-300">{formatPrice(listPrice)}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-emerald-400">◆ Expected sale</span>
                <span className="font-mono text-slate-200">{formatPrice(expectedPrice)}</span>
              </li>
            </ul>
          </div>

          <p className="border-t pt-3 text-xs text-muted-foreground">
            List-aware estimate from recent sold-vs-ask{city ? ` in ${city}` : ""} — what this
            specific listing is likely to close at. May shift if the asking price changes. Our
            estimate, not an MLS or TRREB figure.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
