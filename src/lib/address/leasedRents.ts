/**
 * Typical rents, upgraded to ACTUAL leased prices (owner decision 2026-07-24):
 * signed-in consumers see medians of what homes really leased for (VOW closes,
 * rolling ~180 days — audited to run 3–8× the live-inventory sample); anonymous
 * visitors keep the asking-rent grid (IDX-public) plus a sign-in nudge.
 *
 * SERVER-ONLY. THE GATE IS STRUCTURAL: getLeasedNearPoint (VOW) runs only inside
 * the isConsumer branch of getBestTypicalRents — the anonymous path never fetches
 * a leased price. Same adaptive radius as the asking grid: 2 km, widened to 5 km
 * when the local sample is thin, denser grid wins.
 */
import { getLeasedNearPoint } from "@/lib/sold/soldByKey";
import {
  buildBedsTypeMatrix,
  pickRentMatrix,
  getTypicalRents,
  type NearbyForSale,
  type TypicalRents,
} from "@/lib/address/nearbyForSale";

const RENT_TARGET_SAMPLE = 12;
const WIDE_RENT_RADIUS_KM = 5;

/** CONSUMER-ONLY: leased-close medians with the adaptive radius. */
export async function getLeasedTypicalRents(lat: number, lng: number): Promise<TypicalRents | null> {
  const near = buildBedsTypeMatrix(await getLeasedNearPoint(lat, lng, 2));
  if (near && near.sample >= RENT_TARGET_SAMPLE) return { matrix: near, radiusKm: 2 };
  const wide = buildBedsTypeMatrix(await getLeasedNearPoint(lat, lng, WIDE_RENT_RADIUS_KM));
  return pickRentMatrix(near, 2, wide, WIDE_RENT_RADIUS_KM);
}

export interface RentsView extends TypicalRents {
  /** "leased" = actual close prices (consumer/VOW); "asking" = live list prices (public). */
  source: "leased" | "asking";
}

/**
 * The grid a given viewer should see: consumers get leased closes (falling back to
 * asking when the lease archive is thin here); anonymous viewers get asking only.
 * `leaseFirst` forwards an already-fetched 2 km lease query so the asking path
 * costs no duplicate request.
 */
export async function getBestTypicalRents(
  lat: number,
  lng: number,
  isConsumer: boolean,
  leaseFirst?: NearbyForSale | null
): Promise<RentsView | null> {
  if (isConsumer) {
    const leased = await getLeasedTypicalRents(lat, lng);
    if (leased) return { ...leased, source: "leased" };
  }
  const asking = await getTypicalRents(lat, lng, leaseFirst);
  return asking ? { ...asking, source: "asking" } : null;
}
