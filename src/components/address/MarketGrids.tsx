/**
 * Responsive shell for the sell + rent market grids.
 *   - < lg  → ONE interactive card: a Sold/Leased toggle + bedroom chips collapse the
 *             two stacked 7-column tables into a short, tap-to-explore list
 *             (MarketGridsMobile) — no side-scroll, ~a third of the height.
 *   - ≥ lg  → the two aligned MarketGridCard tables, unchanged (cross-bed comparison).
 *
 * Takes the same `{ matrix, radiusKm, source }` objects the callers already build
 * (getBestTypicalPrices / getBestTypicalRents), so a call site swaps two adjacent cards
 * for one <MarketGrids>. VOW gate is upstream; nothing gated is added here.
 */
import MarketGridCard from "./MarketGridCard";
import MarketGridsMobile, { type MobileGrid } from "./MarketGridsMobile";
import type { AskingMatrix } from "@/lib/address/nearbyForSale";

interface SellGrid {
  matrix: AskingMatrix | null;
  radiusKm: number;
  source: "sold" | "asking";
}
interface RentGrid {
  matrix: AskingMatrix | null;
  radiusKm: number;
  source: "leased" | "asking";
}

export default function MarketGrids({
  sell,
  rent,
  salesFirst = true,
  showSignInNudge = false,
}: {
  sell?: SellGrid | null;
  rent?: RentGrid | null;
  salesFirst?: boolean;
  showSignInNudge?: boolean;
}) {
  const s = sell?.matrix ? sell : null;
  const r = rent?.matrix ? rent : null;
  if (!s && !r) return null;

  const mobileSell: MobileGrid | null = s ? { matrix: s.matrix!, radiusKm: s.radiusKm, actual: s.source === "sold" } : null;
  const mobileRent: MobileGrid | null = r ? { matrix: r.matrix!, radiusKm: r.radiusKm, actual: r.source === "leased" } : null;

  const sellCard = s ? (
    <MarketGridCard matrix={s.matrix} radiusKm={s.radiusKm} flavor="sell" actual={s.source === "sold"} showSignInNudge={showSignInNudge} />
  ) : null;
  const rentCard = r ? (
    <MarketGridCard matrix={r.matrix} radiusKm={r.radiusKm} flavor="rent" actual={r.source === "leased"} showSignInNudge={showSignInNudge} />
  ) : null;

  return (
    <>
      <div className="lg:hidden">
        <MarketGridsMobile sell={mobileSell} rent={mobileRent} salesFirst={salesFirst} showSignInNudge={showSignInNudge} />
      </div>
      <div className="hidden space-y-4 lg:block">
        {salesFirst ? (
          <>
            {sellCard}
            {rentCard}
          </>
        ) : (
          <>
            {rentCard}
            {sellCard}
          </>
        )}
      </div>
    </>
  );
}
