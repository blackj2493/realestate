/**
 * GET /api/market/listing-outcomes?region=<city|neighbourhood>
 *
 * Sell-through / withdrawal rate for a market area, via region_listing_outcomes()
 * (migration 066): distinct properties that de-listed without a recorded sale vs those
 * that sold, over a trailing 12 months. Powers the Phase-2 "Sell-Through" panel.
 *
 * Derived STATISTICS (not listing rows). Thin consumer gate + cache wrapper. Mirrors
 * dom-distribution.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getListingOutcomesCached, EMPTY_OUTCOMES, type ListingOutcomes } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic";

export type { ListingOutcomes };

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  const typeKeys = parseTypeKeys(params);
  if (!region) return NextResponse.json({ region: "", outcomes: EMPTY_OUTCOMES });

  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, outcomes: EMPTY_OUTCOMES, locked: true });
  }

  try {
    const outcomes = await getListingOutcomesCached(region, typeKeys);
    return NextResponse.json({ region, outcomes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/listing-outcomes]", region, msg);
    return NextResponse.json({ region, outcomes: EMPTY_OUTCOMES, error: msg }, { status: 500 });
  }
}
