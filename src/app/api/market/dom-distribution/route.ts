/**
 * GET /api/market/dom-distribution?region=<city|neighbourhood>
 *
 * Full-population True-DoM distribution for a market area, via the
 * region_dom_distribution() RPC (migration 056): median/p25/p75 true_dom + 5 aging
 * buckets. Powers the Tier-1 "True Days on Market" panel on /analytics.
 *
 * Derived STATISTICS (not listing rows), so the 100-listing display cap (§6.3b) does
 * not apply. Thin consumer gate + cache wrapper around getDomDistCached — cached 24h
 * per scope, service-role client bypasses RLS. Mirrors /api/market/region-stats.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getDomDistCached, EMPTY_DOM, type DomDist, type Scope } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic"; // caching handled by unstable_cache per scope

export type { DomDist };

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
  if (!region) return NextResponse.json({ region: "", dom: EMPTY_DOM });

  // Same gate as region-stats: True DoM is IDX-derived active-inventory data; anon
  // callers get a locked shape before the cache/RPC scan.
  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, dom: EMPTY_DOM, locked: true });
  }

  try {
    const dom = await getDomDistCached(region, typeKeys, scope);
    return NextResponse.json({ region, dom });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/dom-distribution]", region, msg);
    return NextResponse.json({ region, dom: EMPTY_DOM, error: msg }, { status: 500 });
  }
}
