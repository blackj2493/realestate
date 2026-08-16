/**
 * Market grids for the listing detail page — "what homes sell for here" (median +
 * middle-50% range) and "typical rents" by bedrooms × property type around this home.
 *
 * Server component, best-effort: resolves the listing's coordinates from the
 * active index first, then the sold store (SOLD pages — their `properties` doc is
 * pruned by the ghost reconcile, but the coords live on the sold doc; the lookup
 * is PUBLIC fields only, see getSoldPublicByKey). Renders null when coords or the
 * samples are missing — mount unconditionally, ideally inside <Suspense>.
 *
 * Consumers see ACTUAL closes (VOW — structural gate in the fetchers); anon sees
 * asking medians (IDX-public). `salesFirst` orders the two grids by what the
 * visitor came for: sale listings lead with prices, rentals with rents.
 */
import { getTypesenseClient } from "@/lib/typesense/client";
import { getSoldPublicByKey } from "@/lib/sold/soldByKey";
import { getBestTypicalRents } from "@/lib/address/leasedRents";
import { getBestTypicalPrices } from "@/lib/address/soldPrices";
import { getConsumer } from "@/lib/auth/requireConsumer";
import MarketGrids from "@/components/address/MarketGrids";

async function resolveCoords(listingId: string): Promise<[number, number] | null> {
  try {
    const res = await getTypesenseClient()
      .collections("properties")
      .documents()
      .search({
        q: "*",
        query_by: "City",
        filter_by: `id:=${listingId}`,
        include_fields: "id,location",
        per_page: 1,
      });
    const loc = (res.hits?.[0]?.document as { location?: [number, number] } | undefined)?.location;
    if (Array.isArray(loc) && loc.length === 2 && (loc[0] || loc[1])) return [loc[0], loc[1]];
  } catch {
    /* fall through to the sold store */
  }
  try {
    const sold = await getSoldPublicByKey(listingId);
    if (sold?.location) return sold.location;
  } catch {
    /* no coords anywhere — self-hide */
  }
  return null;
}

export default async function TypicalRents({ listingId, salesFirst = true }: { listingId: string; salesFirst?: boolean }) {
  const coords = await resolveCoords(listingId);
  if (!coords) return null;
  // Adaptive radius (2 km → 5 km when thin) on all paths.
  const { isConsumer } = await getConsumer();
  const [rents, prices] = await Promise.all([
    getBestTypicalRents(coords[0], coords[1], isConsumer),
    getBestTypicalPrices(coords[0], coords[1], isConsumer),
  ]);
  if (!rents && !prices) return null;
  return (
    <div className="mb-6">
      <MarketGrids sell={prices ?? null} rent={rents ?? null} salesFirst={salesFirst} showSignInNudge={!isConsumer} />
    </div>
  );
}
