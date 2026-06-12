"use client";

/**
 * SoldOutcomeCard — "Our Call vs. The Sale". Once a listing sells we show the
 * receipt: how close our closest model (almost always the Expected Sale Price;
 * True Value when the AVM was nearer) came to the actual close. Confidence-aware
 * copy: |diff| ≤ 3% gets the headline "Within X%" treatment; bigger misses get
 * neutral framing — a miss must never read as a hidden flex (spec §2).
 *
 * VOW-gated: sold price + accuracy are VOW-derived → blurred teaser for anon
 * (the real numbers never reach their DOM; the server nulls soldAccuracy).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { SoldAccuracy } from "@/lib/property/listingStatus";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

/** ≤3% |diff| → bragging tone; above → neutral. */
const BRAG_THRESHOLD_PCT = 3;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

export default function SoldOutcomeCard({
  accuracy,
  closeDate,
  locked,
}: {
  accuracy: SoldAccuracy | null;
  closeDate?: string | null;
  /** VOW gate: render a blurred "sign in" teaser for anon (only when data exists). */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Our Call vs. The Sale</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <div className="space-y-2 blur-sm select-none" aria-hidden="true">
              <p className="text-3xl font-bold text-primary">Within 0.0%</p>
              <p className="text-sm text-muted-foreground">
                We expected $0,000,000 — it sold for $0,000,000.
              </p>
            </div>
            <VowGateOverlay message="Sign in to see the sold price and how close our estimate was" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!accuracy) return null;

  const absPct = Math.abs(accuracy.diffPct) * 100;
  const brag = absPct <= BRAG_THRESHOLD_PCT;
  const soldLine = `${formatPrice(accuracy.closePrice)}${closeDate ? ` on ${fmtDate(closeDate)}` : ""}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Our Call vs. The Sale</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {brag ? (
            <>
              <p className="text-3xl font-bold text-emerald-400">
                Within {absPct.toFixed(1)}%
              </p>
              <p className="text-sm text-slate-300">
                We expected{" "}
                <span className="font-mono text-slate-100">{formatPrice(accuracy.estimateValue)}</span>{" "}
                — it sold for <span className="font-mono text-slate-100">{soldLine}</span>.
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold text-slate-200">
                {accuracy.diffPct < 0 ? "Sold above" : "Sold below"} our call
              </p>
              <p className="text-sm text-slate-300">
                We expected{" "}
                <span className="font-mono text-slate-100">{formatPrice(accuracy.estimateValue)}</span>; it
                sold for <span className="font-mono text-slate-100">{soldLine}</span> —{" "}
                {absPct.toFixed(1)}% {accuracy.diffPct < 0 ? "above" : "below"} our estimate.
              </p>
            </>
          )}

          <p className="border-t pt-3 text-xs text-muted-foreground">
            Call made by our {accuracy.modelLabel} model before the sale price was known.
            Deterministic estimate — not an MLS or TRREB figure.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
