/**
 * GET /api/market/rental-yield?region=<city|neighbourhood>
 *
 * Per-bedroom typical rent + gross yield for a market area, via region_rental_yield()
 * (migration 062): rental_market_index rent paired with the trailing-12mo median sold
 * price. Powers the Phase-2 "Rent & Gross Yield" panel.
 *
 * Derived STATISTICS (not listing rows). Thin consumer gate + cache wrapper. Scope is
 * region + property-type only (the rental index is keyed by region/type/beds, not the
 * numeric lens). Mirrors dom-distribution.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getRentalYieldCached, EMPTY_RENTAL, type RentalYield } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic";

export type { RentalYield };

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  const typeKeys = parseTypeKeys(params);
  if (!region) return NextResponse.json({ region: "", rental: EMPTY_RENTAL });

  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, rental: EMPTY_RENTAL, locked: true });
  }

  try {
    const rental = await getRentalYieldCached(region, typeKeys);
    return NextResponse.json({ region, rental });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/rental-yield]", region, msg);
    return NextResponse.json({ region, rental: EMPTY_RENTAL, error: msg }, { status: 500 });
  }
}
