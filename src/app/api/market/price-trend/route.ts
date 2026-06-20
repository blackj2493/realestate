/**
 * GET /api/market/price-trend?region=<city|neighbourhood>
 *
 * Monthly median SOLD price + median $/sqft for a market area over the trailing 24
 * months, plus a 90-day sold-to-list summary, from raw_vow_sold (read-only — §12).
 *
 * The heavy lifting now lives in the region_price_trend RPC (migration 040): one SQL
 * pass with percentile_cont instead of the old up-to-8-page Node pagination that
 * seq-scanned the 223k-row table per page (the cause of /analytics taking 8-10s). This
 * handler is a thin gate + cache wrapper around getTrendCached (src/lib/market/aggregates).
 * Result is cached 24h per scope so repeated loads never re-run the scan at request time.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getTrendCached, EMPTY_SUMMARY, type Scope } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic"; // caching is handled by unstable_cache per scope

// Letters/digits/spaces/hyphen/apostrophe/period only — matches every real GTA
// municipality & community name and excludes PostgREST/ilike metacharacters.
const REGION_RE = /^[\p{L}\p{N}\s\-'.]{1,60}$/u;

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
  if (!region) return NextResponse.json({ region: "", points: [], summary: EMPTY_SUMMARY });
  if (!REGION_RE.test(region)) {
    return NextResponse.json({ error: "Invalid region" }, { status: 400 });
  }

  // VOW gate: sold-price trends are derived from raw_vow_sold. Anonymous users get a
  // locked shape (no data) BEFORE the cache/scan — so we never touch raw_vow_sold for
  // them (also protects the Supabase IO budget; memory supabase-io-budget).
  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, points: [], summary: EMPTY_SUMMARY, locked: true });
  }

  try {
    const { points, summary } = await getTrendCached(region, typeKeys, scope);
    return NextResponse.json({ region, points, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/price-trend]", region, msg);
    return NextResponse.json({ region, points: [], summary: EMPTY_SUMMARY, error: msg }, { status: 500 });
  }
}
