"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { AVMResult, AnchorBasis } from "@/lib/avm/types";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

interface ListingEstimateCardProps {
  estimate: AVMResult | null;
  listPrice: number;
  cityRegion?: string;
  city?: string;
  /** VOW gate: AVM is VOW-derived — render a blurred "Login Required" teaser for anon. */
  locked?: boolean;
  /** Sold/de-listed views: the ask is moot — suppress the "below/above ask" delta line. */
  hideAskDelta?: boolean;
}

const CONFIDENCE_STYLES: Record<AVMResult["confidence"], string> = {
  HIGH: "bg-green-100 text-green-800 border-green-300",
  MEDIUM: "bg-yellow-100 text-yellow-800 border-yellow-300",
  LOW: "bg-muted text-muted-foreground border-border",
};

function ConfidenceChip({ confidence }: { confidence: AVMResult["confidence"] }) {
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 border rounded ${CONFIDENCE_STYLES[confidence]}`}
    >
      {confidence} CONFIDENCE
    </span>
  );
}

export default function ListingEstimateCard({
  estimate,
  listPrice,
  cityRegion,
  city,
  locked,
  hideAskDelta,
}: ListingEstimateCardProps) {
  if (locked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estimated Value</CardTitle>
          <p className="text-xs text-muted-foreground">
            What comparable sales suggest this home is worth.
          </p>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <div className="space-y-2 blur-sm select-none" aria-hidden="true">
              <p className="text-3xl font-bold text-primary">$0,000,000</p>
              <p className="text-xs font-mono text-muted-foreground">Range $000K – $000K</p>
              <p className="text-sm font-medium text-muted-foreground">↓ $00,000 below ask</p>
            </div>
            <VowGateOverlay message="Sign in to view the Estimated Value" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const unavailable =
    !estimate || estimate.estimatedValue <= 0 || estimate.anchorPrice <= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimated Value</CardTitle>
        <p className="text-xs text-muted-foreground">
          What comparable sales suggest this home is worth.
        </p>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <div className="space-y-1">
            <p className="text-lg font-semibold text-muted-foreground">
              Estimate unavailable
            </p>
            <p className="text-sm text-muted-foreground">
              We can&apos;t produce a confident estimate
              {cityRegion ? ` in ${cityRegion}` : ""} for this property yet —
              too few comparable sales and the precomputed prior is missing
              or noisy.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-3xl font-bold text-primary">
                {formatPrice(estimate.estimatedValue)}
              </p>
              {estimate.lowBand > 0 && estimate.highBand > 0 && (
                <p className="mt-1 text-xs font-mono text-muted-foreground">
                  Range {formatPrice(estimate.lowBand)} – {formatPrice(estimate.highBand)}
                </p>
              )}
              {!hideAskDelta && (
                <DeltaVsAsking
                  estimatedValue={estimate.estimatedValue}
                  listPrice={listPrice}
                />
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <ConfidenceChip confidence={estimate.confidence} />
              <span className="text-[10px] font-mono text-muted-foreground">
                ±{(estimate.predictiveSD * 100).toFixed(1)}%
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              {basisCopy(estimate.basis, estimate.comps, cityRegion, city)}
              {estimate.engineMode === "COEFFICIENT_ADJUSTED"
                ? " · adjusted for size/beds/baths/parking/condition"
                : ""}
              . Our estimate — not an MLS or TRREB figure.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Translates the anchor pipeline's `basis` into a plain-English provenance
 * line. We tell the user EXACTLY where the level came from — measurably more
 * transparent than HouseSigma/Realtor.ca (CLAUDE.md §10).
 */
function basisCopy(
  basis: AnchorBasis,
  comps: number,
  cityRegion: string | undefined,
  city: string | undefined
): string {
  const here = cityRegion ?? city ?? "this area";
  switch (basis) {
    case "local":
      return `Based on ${comps} recent ${here} sales, trend-adjusted to today`;
    case "blend":
      return `Blends ${comps} recent ${here} sales with a trend-adjusted ${here} baseline`;
    case "prior":
      return `Trend-adjusted ${here} baseline (no recent local comps in the past year)`;
    case "parent":
      return city
        ? `Based on adjacent ${city} sales (no local ${here} baseline yet)`
        : "Based on adjacent city-level sales";
    case "borrowed":
      return `Comped against ${comps} size-matched ${here} sales, adjusted with the ${city ?? "nearby"} model (no local model for ${here} yet)`;
    case "peer":
      return `Comped against ${comps} similar ${here}-area sales (size/beds/baths-matched), trend-adjusted to today`;
    case "floor":
      return `Larger or more upgraded than any recent ${here} comp — shown as a neighbourhood floor, not a full valuation`;
    case "none":
    default:
      return `Insufficient data to confidently estimate ${here}`;
  }
}

function DeltaVsAsking({
  estimatedValue,
  listPrice,
}: {
  estimatedValue: number;
  listPrice: number;
}) {
  if (!listPrice || listPrice <= 0) return null;

  const delta = estimatedValue - listPrice;
  if (delta === 0) {
    return (
      <p className="text-sm font-medium text-muted-foreground mt-1">
        In line with asking price
      </p>
    );
  }

  const below = delta < 0;
  return (
    <p
      className={`text-sm font-medium mt-1 ${
        below ? "text-red-600" : "text-green-600"
      }`}
    >
      {below ? "↓" : "↑"} {formatPrice(Math.abs(delta))}{" "}
      {below ? "below ask" : "above ask"}
    </p>
  );
}
