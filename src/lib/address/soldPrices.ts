/**
 * "What homes sell for here" — the sell-side twin of leasedRents.ts (owner decision
 * 2026-07-24): signed-in consumers see medians + middle-50% ranges of what homes
 * really SOLD for (VOW closes, rolling ~180 days); anonymous visitors get the
 * asking-price grid from live FOR SALE actives (IDX-public) plus a sign-in nudge.
 *
 * The range is the design answer to heterogeneous stock (probed live 2026-07-24:
 * suburban beds×type cells run 4–11% IQR/median, downtown condo cells 20–39%) — a
 * bare median downtown would be falsely precise, so every cell with ≥5 kept points
 * carries its p25–p75 band.
 *
 * SERVER-ONLY. THE GATE IS STRUCTURAL: getSoldNearPoint (VOW) runs only inside the
 * isConsumer branch of getBestTypicalPrices — the anonymous path never fetches a
 * close price. Same adaptive radius as the rents grid: 2 km, widened to 5 km when
 * the local sample is thin, denser grid wins.
 */
import { getSoldNearPoint } from "@/lib/sold/soldByKey";
import {
  buildBedsTypeMatrix,
  pickRentMatrix,
  getNearbyForSale,
  type NearbyForSale,
  type TypicalRents,
} from "@/lib/address/nearbyForSale";

const TARGET_SAMPLE = 12;
const WIDE_RADIUS_KM = 5;

/** CONSUMER-ONLY: sold-close medians + ranges with the adaptive radius. */
export async function getSoldTypicalPrices(lat: number, lng: number): Promise<TypicalRents | null> {
  // `found` is carried through so the card can print the real population rather than
  // the page size — see AskingMatrix.total.
  const nearHits = await getSoldNearPoint(lat, lng, 2);
  const near = buildBedsTypeMatrix(nearHits.items, { mode: "sale", total: nearHits.found });
  if (near && near.sample >= TARGET_SAMPLE) return { matrix: near, radiusKm: 2 };
  const wideHits = await getSoldNearPoint(lat, lng, WIDE_RADIUS_KM);
  const wide = buildBedsTypeMatrix(wideHits.items, { mode: "sale", total: wideHits.found });
  return pickRentMatrix(near, 2, wide, WIDE_RADIUS_KM);
}

export interface PricesView extends TypicalRents {
  /** "sold" = actual close prices (consumer/VOW); "asking" = live list prices (public). */
  source: "sold" | "asking";
}

/**
 * The sell-side grid a given viewer should see: consumers get sold closes (falling
 * back to asking when the sale archive is thin here); anonymous viewers get asking
 * only. `saleFirst` forwards an already-fetched 2 km FOR SALE query so the asking
 * path costs no duplicate request.
 */
export async function getBestTypicalPrices(
  lat: number,
  lng: number,
  isConsumer: boolean,
  saleFirst?: NearbyForSale | null
): Promise<PricesView | null> {
  if (isConsumer) {
    const sold = await getSoldTypicalPrices(lat, lng);
    if (sold) return { ...sold, source: "sold" };
  }
  const near = saleFirst !== undefined ? saleFirst : await getNearbyForSale(lat, lng);
  const nearMatrix = near?.bedsTypeMatrix ?? null;
  if (nearMatrix && nearMatrix.sample >= TARGET_SAMPLE) {
    return { matrix: nearMatrix, radiusKm: near!.radiusKm, source: "asking" };
  }
  const wide = await getNearbyForSale(lat, lng, { radiusKm: WIDE_RADIUS_KM });
  const picked = pickRentMatrix(nearMatrix, near?.radiusKm ?? 2, wide?.bedsTypeMatrix ?? null, wide?.radiusKm ?? WIDE_RADIUS_KM);
  return picked ? { ...picked, source: "asking" } : null;
}
