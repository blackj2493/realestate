/**
 * GET /api/market/seasonality?region=<city|neighbourhood>
 *
 * Monthly (1–12) seasonality over 5 years of sold history, via region_seasonality()
 * (migration 065): sales volume, year-normalized price index, sold-to-list. Powers the
 * Phase-2 "Best month to buy/sell" panel.
 *
 * Derived STATISTICS (not listing rows). Thin consumer gate + cache wrapper. Mirrors
 * dom-distribution.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getSeasonalityCached, EMPTY_SEASONALITY, type Seasonality } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic";

export type { Seasonality };

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  const typeKeys = parseTypeKeys(params);
  if (!region) return NextResponse.json({ region: "", seasonality: EMPTY_SEASONALITY });

  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, seasonality: EMPTY_SEASONALITY, locked: true });
  }

  try {
    const seasonality = await getSeasonalityCached(region, typeKeys);
    return NextResponse.json({ region, seasonality });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/seasonality]", region, msg);
    return NextResponse.json({ region, seasonality: EMPTY_SEASONALITY, error: msg }, { status: 500 });
  }
}
