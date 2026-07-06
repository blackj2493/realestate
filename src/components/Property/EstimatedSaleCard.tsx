"use client";

/**
 * EstimatedSaleCard — THE single price number on a listing. Replaces the old two-number
 * display (list-blind "True Value" AVM + list-aware "Expected Sale Price"), which confused
 * users. The headline is whatever `resolveSalePrice` picked as most accurate:
 *   • active listing w/ a trustworthy cohort ratio → list-anchored Expected Sale
 *     (~2% median |%err|, ~80% within ±5% on held-out sales), and the AVM is drawn as a
 *     faint "comparable value" band for context — resolving how the two relate on ONE track.
 *   • thin cohort / no live ask → the AVM is the honest fallback headline.
 *
 * VOW-derived (the close/list ratio + AVM come from raw_vow_sold) → renders a blurred
 * "Login Required" teaser for anon; the server nulls the inputs so the real value never
 * reaches their DOM. Mirrors the prior ExpectedSaleCard structure.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import { axisPosition, lineupDomain } from "@/lib/avm/expectedSale";
import type { SalePriceEstimate } from "@/lib/avm/salePrice";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

interface EstimatedSaleCardProps {
  salePrice: SalePriceEstimate | null;
  listPrice: number;
  city?: string;
  propertySubType?: string;
  /** VOW gate: inputs are VOW-derived — render a blurred teaser for anon. */
  locked?: boolean;
}

// LIGHT: solid confidence pill (a USP signal — how sure we are pops); DARK: original tint.
const CONFIDENCE_STYLES: Record<SalePriceEstimate["confidence"], string> = {
  HIGH: "bg-emerald-600 text-white border-emerald-600 dark:bg-green-100 dark:text-green-800 dark:border-green-300",
  MEDIUM: "bg-amber-500 text-white border-amber-500 dark:bg-yellow-100 dark:text-yellow-800 dark:border-yellow-300",
  LOW: "bg-muted text-muted-foreground border-border",
};

export default function EstimatedSaleCard({
  salePrice,
  listPrice,
  city,
  propertySubType,
  locked,
}: EstimatedSaleCardProps) {
  if (locked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estimated Sale Price</CardTitle>
          <p className="text-xs text-muted-foreground">What this home is likely to close at.</p>
        </CardHeader>
        <CardContent>
          <div className="relative min-h-[8.5rem]">
            <div className="space-y-2 blur-sm select-none" aria-hidden="true">
              <p className="text-3xl font-bold text-primary">$0,000,000</p>
              <p className="text-xs font-mono text-muted-foreground">Likely range $000K – $000K</p>
              <p className="text-sm font-medium text-muted-foreground">≈ $00,000 below ask</p>
            </div>
            <VowGateOverlay
              headline="See what this home should sell for"
              message={`Our estimate of the likely closing price and range for this ${
                propertySubType ?? "home"
              }${city ? ` in ${city}` : ""}${
                listPrice > 0 ? `, and how it stacks up against the ${formatPrice(listPrice)} ask` : ""
              }.`}
              ctaLabel="See it free →"
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!salePrice || !(salePrice.value > 0)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estimated Sale Price</CardTitle>
          <p className="text-xs text-muted-foreground">What this home is likely to close at.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <p className="text-lg font-semibold text-muted-foreground">Estimate unavailable</p>
            <p className="text-sm text-muted-foreground">
              We can&apos;t produce a confident estimate for this property yet — too few recent
              comparable sales{city ? ` in ${city}` : ""}.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { value, lowBand, highBand, confidence, deltaVsAskPct, provenance, market, comparable } =
    salePrice;

  const hasAsk = listPrice > 0 && deltaVsAskPct !== null;
  const below = (deltaVsAskPct ?? 0) < 0;
  const deltaAbs = Math.abs(value - listPrice);
  const deltaPctStr = `${below ? "" : "+"}${((deltaVsAskPct ?? 0) * 100).toFixed(1)}%`;

  // ── "How it lines up" axis ──────────────────────────────────────────────────
  const compLo = comparable ? comparable.low : null;
  const compHi = comparable ? comparable.high : null;
  const compMid = comparable ? comparable.mid : null;
  const hasComp = compLo !== null && compHi !== null && compHi > compLo;

  const domain = lineupDomain([compLo ?? 0, compHi ?? 0, hasAsk ? listPrice : 0, value]);
  const pos = (v: number | null) => (v === null ? null : axisPosition(v, domain.min, domain.max) * 100);
  const askPos = hasAsk ? pos(listPrice)! : null;
  const valPos = pos(value)!;
  const loPos = pos(compLo);
  const hiPos = pos(compHi);
  const midPos = pos(compMid);

  const where =
    market && market.scope === "cohort"
      ? `${propertySubType ?? "Homes"} in ${city ?? "this market"}`
      : (city ?? "This market");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimated Sale Price</CardTitle>
        <p className="text-xs text-muted-foreground">What this home is likely to close at.</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Hero number + range + delta — the AVM is a flagship USP, so it's the
              loudest thing in the card, and the delta is colour-coded (below ask =
              buyer opportunity = green; above ask = premium = red). */}
          <div>
            <p className="text-4xl font-extrabold tracking-tight text-primary">{formatPrice(value)}</p>
            <p className="mt-1 text-xs font-mono text-muted-foreground">
              Likely range {formatPrice(lowBand)} – {formatPrice(highBand)}
            </p>
            {hasAsk && (
              <p
                className={`mt-1 text-sm font-semibold ${
                  below ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                }`}
              >
                ≈ {formatPrice(deltaAbs)} ({deltaPctStr}) {below ? "below" : "above"} ask
                {below ? " · room to negotiate" : ""}
              </p>
            )}
          </div>

          {/* Confidence + method */}
          <div className="flex items-center justify-between">
            <span
              className={`text-xs font-medium px-2 py-0.5 border rounded ${CONFIDENCE_STYLES[confidence]}`}
            >
              {confidence} CONFIDENCE
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {market ? "List-anchored" : "Comp-based"}
            </span>
          </div>

          {/* Market-temperature line (only when list-anchored) */}
          {market && (
            <p className="text-xs text-muted-foreground">
              {where} are closing at{" "}
              <span className="font-mono text-foreground">~{(market.ratio * 100).toFixed(1)}% of ask</span>{" "}
              right now ({market.sampleSize} recent{" "}
              {market.scope === "cohort" ? "comparable " : ""}sales, trailing {market.windowMonths} mo).
            </p>
          )}

          {/* "How it lines up" axis: ask + estimate + (optional) comparable value range */}
          {(hasAsk || hasComp) && (
            <div className="pt-1">
              <p className="mb-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                How it lines up
              </p>
              <div className="relative h-9">
                <div className="absolute left-0 right-0 top-4 h-1.5 rounded-full bg-muted" />
                {/* comparable-value range segment (the AVM band) — secondary context */}
                {hasComp && loPos !== null && hiPos !== null && (
                  <div
                    className="absolute top-4 h-1.5 rounded-full bg-slate-400 dark:bg-slate-600"
                    style={{ left: `${loPos}%`, width: `${Math.max(0, hiPos - loPos)}%` }}
                    title="Comparable value range (independent of ask)"
                  />
                )}
                {midPos !== null && (
                  <div
                    className="absolute top-[12px] h-3 w-0.5 -translate-x-1/2 bg-slate-500 dark:bg-slate-400"
                    style={{ left: `${midPos}%` }}
                    title="Comparable value (mid)"
                  />
                )}
                {askPos !== null && (
                  <div
                    className="absolute top-0 -translate-x-1/2 text-[9px] leading-none text-amber-700 dark:text-amber-400"
                    style={{ left: `${askPos}%` }}
                    title="Asking price"
                  >
                    ▲
                  </div>
                )}
                <div
                  className="absolute top-[11px] -translate-x-1/2 text-[11px] leading-none text-emerald-700 dark:text-emerald-400"
                  style={{ left: `${valPos}%` }}
                  title="Estimated sale price"
                >
                  ◆
                </div>
              </div>

              <ul className="mt-1.5 space-y-1 text-[11px]">
                {hasComp && (
                  <li className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      <span className="text-muted-foreground">▬</span> Comparable value
                    </span>
                    <span className="font-mono text-foreground">
                      {formatPrice(compLo!)} – {formatPrice(compHi!)}
                    </span>
                  </li>
                )}
                {hasAsk && (
                  <li className="flex items-center justify-between">
                    <span className="text-amber-700 dark:text-amber-400">▲ Asking</span>
                    <span className="font-mono text-foreground">{formatPrice(listPrice)}</span>
                  </li>
                )}
                <li className="flex items-center justify-between">
                  <span className="text-emerald-700 dark:text-emerald-400">◆ Estimated sale</span>
                  <span className="font-mono text-foreground">{formatPrice(value)}</span>
                </li>
              </ul>
            </div>
          )}

          <p className="border-t pt-3 text-xs text-muted-foreground">
            {provenance} May shift if the asking price changes. Our estimate, not an MLS or TRREB
            figure.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
