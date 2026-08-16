/**
 * What homes sell for here — median sale price by bedrooms × property type, each
 * well-sampled cell carrying its middle-50% range (owner call 2026-07-24: in
 * heterogeneous stock the range IS the information).
 *
 * Two sources (see lib/address/soldPrices.ts):
 *  - "sold" (consumers): medians/ranges of ACTUAL close prices from the VOW archive.
 *    Mount only with consumer-fetched data — the structural gate lives in the fetcher.
 *  - "asking" (everyone): medians/ranges of live FOR SALE list prices (IDX-public).
 *
 * Thin wrapper over MarketGridCard (the shared visual shell for the sell + rent
 * grids); all rendering rules live there.
 */
import MarketGridCard from "./MarketGridCard";
import type { AskingMatrix } from "@/lib/address/nearbyForSale";

export default function TypicalPricesCard({
  matrix,
  radiusKm,
  source = "asking",
  showSignInNudge = false,
}: {
  matrix: AskingMatrix | null;
  radiusKm: number;
  /** "sold" = actual close prices (consumer/VOW); "asking" = live list prices. */
  source?: "sold" | "asking";
  /** Anonymous viewers: advertise the sold upgrade under the asking grid. */
  showSignInNudge?: boolean;
}) {
  return (
    <MarketGridCard
      matrix={matrix}
      radiusKm={radiusKm}
      flavor="sell"
      actual={source === "sold"}
      showSignInNudge={showSignInNudge}
    />
  );
}
