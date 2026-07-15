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
import { Redact, UnlockCta } from "@/components/Property/teaserPrimitives";

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
    // Redacted frame: the ask is PUBLIC (IDX list price), so we show it to ground the
    // card in THIS home; the estimate, range and confidence are withheld until sign-in.
    return (
      <Card className="border-cyan-500/40">
        <CardHeader>
          <CardTitle>Estimated Sale Price</CardTitle>
          <p className="text-xs text-muted-foreground">What this home is likely to close at.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Redact className="h-9 w-44" />
              <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                Likely range <Redact className="h-3.5 w-16" /> – <Redact className="h-3.5 w-16" />
              </p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">How sure we are</span>
              <Redact className="h-4 w-24" />
            </div>
            <ul className="space-y-1.5 border-t pt-3 text-[11px]">
              {listPrice > 0 && (
                <li className="flex items-center justify-between">
                  <span className="text-amber-700 dark:text-amber-400">▲ Asking</span>
                  <span className="font-mono text-foreground">{formatPrice(listPrice)}</span>
                </li>
              )}
              <li className="flex items-center justify-between">
                <span className="text-emerald-700 dark:text-emerald-400">◆ Estimated sale</span>
                <Redact className="h-3.5 w-20" />
              </li>
            </ul>
            <UnlockCta
              label="See what it should sell for — free"
              note={`Our estimate of the likely closing price${
                city ? ` for this ${propertySubType ?? "home"} in ${city}` : ""
              } — not an MLS or TRREB figure.`}
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

  const { value, lowBand, highBand, confidence, deltaVsAskPct, provenance, market, comparable, competitive, source } =
    salePrice;
  const comp = competitive; // "Priced to Compete" payload (or null)

  const hasAsk = listPrice > 0 && deltaVsAskPct !== null;
  const below = (deltaVsAskPct ?? 0) < 0;
  const deltaAbs = Math.abs(value - listPrice);
  const deltaPctStr = `${below ? "" : "+"}${((deltaVsAskPct ?? 0) * 100).toFixed(1)}%`;
  // Compact money for the range headline/rows so two numbers fit ("$999K – $1.18M").
  const compact = (n: number) =>
    n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
      : n >= 1_000
        ? `$${Math.round(n / 1_000)}K`
        : formatPrice(n);

  // ── "How it lines up" axis ──────────────────────────────────────────────────
  const compLo = comparable ? comparable.low : null;
  const compHi = comparable ? comparable.high : null;
  const compMid = comparable ? comparable.mid : null;
  const hasComp = compLo !== null && compHi !== null && compHi > compLo;

  const domain = lineupDomain(
    comp
      ? [compLo ?? 0, compHi ?? 0, listPrice, comp.rangeHigh]
      : [compLo ?? 0, compHi ?? 0, hasAsk ? listPrice : 0, value],
  );
  const pos = (v: number | null) => (v === null ? null : axisPosition(v, domain.min, domain.max) * 100);
  const askPos = hasAsk ? pos(listPrice)! : null;
  const valPos = pos(value)!;
  const rangeHighPos = comp ? pos(comp.rangeHigh) : null;
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
        {/* Subtitle doubles as the accuracy credential on the standard list-anchored estimate
            (backtest: ~2% median |%err|, 82% within ±5%; padded to ~3% for live listings) —
            leading with confidence instead of a generic descriptor. The AVM fallback (~13%
            median) and the competitive range view fall back to the plain descriptor. */}
        {!comp && source === "expected-sale" && confidence !== "LOW" ? (
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Typically within ~3% of the final sale price.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">What this home is likely to close at.</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Hero. Normally the estimate is the loudest thing (colour-coded delta). When the
              listing is "priced to compete" (below comps + threshold ask) we drop the
              below-ask / "room to negotiate" framing for a ⚡ flag + an at-or-above-ask range
              + a calibrated over-ask probability — never a promise it WILL sell over ask. */}
          {comp ? (
            <>
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
                <span className="text-[13px] leading-none">⚡</span>
                <span className="terminal-font text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Priced to compete
                </span>
              </div>
              <div>
                <p className="text-3xl font-extrabold tracking-tight text-primary">
                  {compact(comp.rangeLow)} – {compact(comp.rangeHigh)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Likely to close at or above the {formatPrice(listPrice)} ask.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-foreground/90">
                  Listed ~{Math.round(comp.belowCompsPct * 100)}% below comparable sales. Homes priced
                  like this sold{" "}
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    over ask ~{Math.round(comp.overAskRate * 100)}% of the time
                  </span>{" "}
                  — expect competing offers.
                </p>
              </div>
            </>
          ) : (
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
          )}

          {/* Confidence + method */}
          <div className="flex items-center justify-between">
            <span
              className={`text-xs font-medium px-2 py-0.5 border rounded ${CONFIDENCE_STYLES[confidence]}`}
            >
              {confidence} CONFIDENCE
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {market
                ? market.sampleSize >= 25
                  ? `Based on ${market.sampleSize.toLocaleString()} sales`
                  : "Market-calibrated"
                : "Comp-based"}
            </span>
          </div>

          {/* Market-temperature line (only when list-anchored) */}
          {market && (
            <p className="text-xs text-muted-foreground">
              {comp ? (
                <>
                  {where} close at{" "}
                  <span className="font-mono text-foreground">~{(market.ratio * 100).toFixed(0)}% of ask</span>{" "}
                  on average — but listings set below comps often draw multiple offers.
                </>
              ) : (
                <>
                  {where} typically close{" "}
                  <span className="font-mono text-foreground">~{(market.ratio * 100).toFixed(1)}% of ask</span>{" "}
                  (last {market.windowMonths} mo).
                </>
              )}
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
                {comp && askPos !== null && rangeHighPos !== null ? (
                  // "Priced to compete": an at-or-above-ask band reaching from the ask up
                  // toward comps, instead of a single below-ask point.
                  <div
                    className="absolute top-4 h-1.5 rounded-full bg-emerald-500/50 ring-1 ring-emerald-600 dark:bg-emerald-400/40 dark:ring-emerald-400"
                    style={{
                      left: `${Math.min(askPos, rangeHighPos)}%`,
                      width: `${Math.max(1, Math.abs(rangeHighPos - askPos))}%`,
                    }}
                    title="Likely close range (at or above ask)"
                  />
                ) : (
                  <div
                    className="absolute top-[11px] -translate-x-1/2 text-[11px] leading-none text-emerald-700 dark:text-emerald-400"
                    style={{ left: `${valPos}%` }}
                    title="Estimated sale price"
                  >
                    ◆
                  </div>
                )}
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
                  <span className="text-emerald-700 dark:text-emerald-400">
                    {comp ? "▮ Likely close" : "◆ Estimated sale"}
                  </span>
                  <span className="font-mono text-foreground">
                    {comp ? `${compact(comp.rangeLow)} – ${compact(comp.rangeHigh)}` : formatPrice(value)}
                  </span>
                </li>
              </ul>
            </div>
          )}

          <p className="border-t pt-3 text-xs text-muted-foreground">
            {comp
              ? `Range widened because this home is listed below comparable sales — a common bidding-war setup. About ${Math.round(
                  comp.overAskRate * 100,
                )}% of such homes sold over ask; many still close near asking. Our estimate, not an MLS or TRREB figure.`
              : `${provenance} Our estimate, not an MLS or TRREB figure.`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
