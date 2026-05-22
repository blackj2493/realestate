"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { AVMResult } from "@/lib/avm/types";

interface ListingEstimateCardProps {
  estimate: AVMResult | null;
  listPrice: number;
  cityRegion?: string;
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
}: ListingEstimateCardProps) {
  const unavailable =
    !estimate || estimate.estimatedValue <= 0 || estimate.anchorPrice <= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>PureProperty Estimate</CardTitle>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <div className="space-y-1">
            <p className="text-lg font-semibold text-muted-foreground">
              Estimate unavailable
            </p>
            <p className="text-sm text-muted-foreground">
              Not enough recent comparable sales
              {cityRegion ? ` in ${cityRegion}` : ""} to estimate this property
              yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-3xl font-bold text-primary">
                {formatPrice(estimate.estimatedValue)}
              </p>
              <DeltaVsAsking
                estimatedValue={estimate.estimatedValue}
                listPrice={listPrice}
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <ConfidenceChip confidence={estimate.confidence} />
            </div>

            <p className="text-xs text-muted-foreground">
              Based on 90-day comparable sales
              {cityRegion ? ` in ${cityRegion}` : ""}
              {estimate.engineMode === "COEFFICIENT_ADJUSTED"
                ? " · adjusted for beds/baths/parking"
                : ""}
              . Our estimate — not an MLS or TRREB figure.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
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
