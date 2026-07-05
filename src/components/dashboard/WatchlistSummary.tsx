"use client";

import type { WatchlistRollup } from "@/lib/watchlist/useWatchlistSnapshot";
import InfoDot from "@/components/ui/InfoDot";
import { Readout, ReadoutCell } from "@/components/daylight/primitives";

function compactPrice(n: number): string {
  if (n >= 1_000_000) return `$${(Math.round((n / 1_000_000) * 100) / 100).toString()}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * At-a-glance characterization of the SAVED set — what you're watching, not a
 * portfolio of holdings. No sum metrics (you're not buying all of them).
 *
 * Rendered as a Daylight "readout" (graticule instrument strip) in light; reverts
 * to the current gapped tiles in dark. Value colours are semantic in both themes.
 */
export default function WatchlistSummary({ rollup }: { rollup: WatchlistRollup }) {
  if (rollup.count === 0) return null;

  const dash = "—";
  const range =
    rollup.minPrice == null || rollup.maxPrice == null
      ? dash
      : rollup.minPrice === rollup.maxPrice
        ? compactPrice(rollup.minPrice)
        : `${compactPrice(rollup.minPrice)}–${compactPrice(rollup.maxPrice)}`;
  const cap = rollup.avgCapRate != null ? `${rollup.avgCapRate.toFixed(1)}%` : dash;
  const best = rollup.bestDeal ? `${rollup.bestDeal.grade} · ${rollup.bestDeal.score}` : dash;

  return (
    <Readout cols={4}>
      <ReadoutCell label="Saved" value={rollup.count.toLocaleString()} />
      <ReadoutCell label="Price Range" value={range} />
      <ReadoutCell
        label={
          <>
            Avg Cap Rate
            <InfoDot term="capRate" />
          </>
        }
        value={cap}
        tone="up"
      />
      <ReadoutCell label="Best Deal Score" value={best} tone="sig" />
    </Readout>
  );
}
