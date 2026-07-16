/**
 * GET /api/market/price-cuts?region=<city|neighbourhood>
 *
 * Full-population price-cut pressure for a market area, via the region_price_cuts()
 * RPC (migration 058): share of active listings reduced + median $ and % cut depth.
 * Powers the Tier-1 "Price-cut pressure" panel on /analytics.
 *
 * Derived STATISTICS (not listing rows), so the 100-listing display cap (§6.3b) does
 * not apply. Thin consumer gate + cache wrapper around getPriceCutsCached. Mirrors
 * /api/market/region-stats.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getPriceCutsCached, EMPTY_CUTS, type PriceCuts, type Scope } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic"; // caching handled by unstable_cache per scope

export type { PriceCuts };

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  const typeKeys = parseTypeKeys(params);
  const basementRaw = params.get("basement");
  const scope: Scope = {
    minBeds: Math.max(0, Math.floor(Number(params.get("minBeds")) || 0)),
    minBaths: Math.max(0, Number(params.get("minBaths")) || 0),
    minParking: Math.max(0, Math.floor(Number(params.get("minParking")) || 0)),
    minFrontage: Math.max(0, Number(params.get("minFrontage")) || 0),
    basement: basementRaw === "finished" || basementRaw === "unfinished" ? basementRaw : "any",
  };
  if (!region) return NextResponse.json({ region: "", cuts: EMPTY_CUTS });

  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, cuts: EMPTY_CUTS, locked: true });
  }

  try {
    const cuts = await getPriceCutsCached(region, typeKeys, scope);
    return NextResponse.json({ region, cuts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/price-cuts]", region, msg);
    return NextResponse.json({ region, cuts: EMPTY_CUTS, error: msg }, { status: 500 });
  }
}
