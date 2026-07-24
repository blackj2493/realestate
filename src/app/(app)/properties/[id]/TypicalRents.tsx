/**
 * "Typical rents nearby" for the listing detail page — median asking rent by
 * bedrooms × property type from live FOR RENT listings around this home.
 *
 * Server component, best-effort: resolves the listing's coordinates from the
 * active index first, then the sold store (SOLD pages — their `properties` doc is
 * pruned by the ghost reconcile, but the coords live on the sold doc; the lookup
 * is PUBLIC fields only, see getSoldPublicByKey). Renders null when coords or the
 * rent sample are missing — mount unconditionally, ideally inside <Suspense>.
 *
 * IDX asking rents are public — no gate (same class as every asking surface).
 */
import { getTypesenseClient } from "@/lib/typesense/client";
import { getSoldPublicByKey } from "@/lib/sold/soldByKey";
import { getBestTypicalRents } from "@/lib/address/leasedRents";
import { getConsumer } from "@/lib/auth/requireConsumer";
import TypicalRentsCard from "@/components/address/TypicalRentsCard";

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

export default async function TypicalRents({ listingId }: { listingId: string }) {
  const coords = await resolveCoords(listingId);
  if (!coords) return null;
  // Consumers see ACTUAL leased closes (VOW — structural gate in the fetcher);
  // anon sees asking medians. Adaptive radius (2 km → 5 km when thin) on both.
  const { isConsumer } = await getConsumer();
  const rents = await getBestTypicalRents(coords[0], coords[1], isConsumer);
  if (!rents) return null;
  return (
    <div className="mb-6">
      <TypicalRentsCard matrix={rents.matrix} radiusKm={rents.radiusKm} source={rents.source} showSignInNudge={!isConsumer} />
    </div>
  );
}
