"use client";

/**
 * SoldOutcomeCard — "Our Call vs. The Sale". Once a listing sells we show the
 * receipt: how close our closest model (almost always the Expected Sale Price;
 * comparable-sales value when the AVM was nearer) came to the actual close. Confidence-aware
 * copy: |diff| ≤ 3% gets the headline "Within X%" treatment; bigger misses get
 * neutral framing — a miss must never read as a hidden flex (spec §2).
 *
 * VOW-gated: sold price + accuracy are VOW-derived → blurred teaser for anon
 * (the real numbers never reach their DOM; the server nulls soldAccuracy).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { SoldAccuracy } from "@/lib/property/listingStatus";
import { Redact, UnlockCta } from "@/components/Property/teaserPrimitives";

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
  soldDate,
  locked,
}: {
  accuracy: SoldAccuracy | null;
  soldDate?: string | null;
  /** VOW gate: render a blurred "sign in" teaser for anon (only when data exists). */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <Card className="border-cyan-500/40">
        <CardHeader>
          <CardTitle>Our Call vs. The Sale</CardTitle>
          <p className="text-xs text-muted-foreground">
            This home has closed — see the sold price and how close our pre-sale call came.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-end gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  We expected
                </p>
                <Redact className="mt-1.5 h-6 w-28" />
              </div>
              <span className="pb-1 text-xs text-muted-foreground">vs</span>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  It sold for
                </p>
                <Redact className="mt-1.5 h-6 w-28" />
              </div>
            </div>
            <div className="flex items-center gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground">Our accuracy</span>
              <Redact className="h-4 w-16" />
            </div>
            <UnlockCta
              label="See the sold price — free"
              note="Deterministic estimate — not an MLS or TRREB figure."
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!accuracy) return null;

  const absPct = Math.abs(accuracy.diffPct) * 100;
  const brag = absPct <= BRAG_THRESHOLD_PCT;
  const soldLine = `${formatPrice(accuracy.closePrice)}${soldDate ? ` on ${fmtDate(soldDate)}` : ""}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Our Call vs. The Sale</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {brag ? (
            <>
              <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
                Within {absPct.toFixed(1)}%
              </p>
              <p className="text-sm text-foreground">
                We expected{" "}
                <span className="font-mono text-foreground">{formatPrice(accuracy.estimateValue)}</span>{" "}
                — it sold for <span className="font-mono text-foreground">{soldLine}</span>.
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold text-foreground">
                {accuracy.diffPct < 0 ? "Sold above" : "Sold below"} our call
              </p>
              <p className="text-sm text-foreground">
                We expected{" "}
                <span className="font-mono text-foreground">{formatPrice(accuracy.estimateValue)}</span>; it
                sold for <span className="font-mono text-foreground">{soldLine}</span> —{" "}
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
