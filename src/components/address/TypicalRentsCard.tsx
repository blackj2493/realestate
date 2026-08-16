/**
 * Typical rents nearby — median rent by bedrooms × property type.
 *
 * Two sources (see lib/address/leasedRents.ts):
 *  - "leased" (consumers): medians of ACTUAL close prices from the VOW lease archive.
 *    Mount only with consumer-fetched data — the structural gate lives in the fetcher.
 *  - "asking" (everyone): medians of live FOR RENT list prices (IDX-public).
 *
 * Thin wrapper over MarketGridCard (the shared visual shell for the sell + rent
 * grids); all rendering rules live there.
 */
import MarketGridCard from "./MarketGridCard";
import type { AskingMatrix } from "@/lib/address/nearbyForSale";

export default function TypicalRentsCard({
  matrix,
  radiusKm,
  source = "asking",
  showSignInNudge = false,
}: {
  matrix: AskingMatrix | null;
  radiusKm: number;
  /** "leased" = actual close prices (consumer/VOW); "asking" = live list prices. */
  source?: "leased" | "asking";
  /** Anonymous viewers: advertise the leased upgrade under the asking grid. */
  showSignInNudge?: boolean;
}) {
  return (
    <MarketGridCard
      matrix={matrix}
      radiusKm={radiusKm}
      flavor="rent"
      actual={source === "leased"}
      showSignInNudge={showSignInNudge}
    />
  );
}
