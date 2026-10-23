/**
 * GET /api/market/price-cut-cost?region=<city|neighbourhood>&types=<keys>
 *
 * What a price cut cost sellers in a market area, via region_price_cut_outcomes()
 * (migration 157): sold houses grouped by cut depth, with the median sold price as a share
 * of the first ask and the median days on market. Powers "The cost of a price cut" panel on
 * /analytics, which the monthly Street Recap links to.
 *
 * Derived STATISTICS from sold data (not listing rows). Thin consumer gate + cache wrapper.
 * Mirrors seasonality.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getPriceCutCostCached } from "@/lib/market/aggregates";
import { EMPTY_PRICE_CUT_COST, type PriceCutCost } from "@/lib/market/priceCutCost";

export const dynamic = "force-dynamic";

export type { PriceCutCost };

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  const typeKeys = parseTypeKeys(params);
  if (!region) return NextResponse.json({ region: "", cost: EMPTY_PRICE_CUT_COST });

  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, cost: EMPTY_PRICE_CUT_COST, locked: true });
  }

  try {
    const cost = await getPriceCutCostCached(region, typeKeys);
    return NextResponse.json({ region, cost });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/price-cut-cost]", region, msg);
    return NextResponse.json({ region, cost: EMPTY_PRICE_CUT_COST, error: msg }, { status: 500 });
  }
}
