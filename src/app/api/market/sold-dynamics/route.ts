/**
 * GET /api/market/sold-dynamics?region=<city|neighbourhood>
 *
 * Full-population sold-side dynamics for a market area, via region_sold_dynamics()
 * (migration 061): time-to-sell (DaysOnMarket p25/median/p75), original-ask→sold gap,
 * and $/sqft dispersion — one trailing-12mo pass. Powers the Phase-2 sold panels.
 *
 * Derived STATISTICS (not listing rows), so the 100-listing cap (§6.3b) does not apply.
 * Thin consumer gate + cache wrapper around getSoldDynamicsCached. Mirrors dom-distribution.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getSoldDynamicsCached, EMPTY_SOLD_DYNAMICS, type SoldDynamics, type Scope } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic"; // caching handled by unstable_cache per scope

export type { SoldDynamics };

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
  if (!region) return NextResponse.json({ region: "", dynamics: EMPTY_SOLD_DYNAMICS });

  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, dynamics: EMPTY_SOLD_DYNAMICS, locked: true });
  }

  try {
    const dynamics = await getSoldDynamicsCached(region, typeKeys, scope);
    return NextResponse.json({ region, dynamics });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/sold-dynamics]", region, msg);
    return NextResponse.json({ region, dynamics: EMPTY_SOLD_DYNAMICS, error: msg }, { status: 500 });
  }
}
