/**
 * GET /api/market/price-ledger?region=<city|neighbourhood>
 *
 * Recent multi-cut price-ledger activity for a market area, via
 * region_price_events_summary() (migrations 069/070): cut count, distinct cutting
 * properties, median cut depth, and 2+-cut properties over the trailing 3 months.
 * Powers the Phase-3 "Price-Cut Activity" panel. Prospective — zeros until the nightly
 * capture accrues events.
 *
 * Derived STATISTICS (not listing rows). Thin consumer gate + cache wrapper. Mirrors
 * dom-distribution.
 */

import { NextRequest, NextResponse } from "next/server";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getPriceLedgerCached, EMPTY_LEDGER, type PriceLedger } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic";

export type { PriceLedger };

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  if (!region) return NextResponse.json({ region: "", ledger: EMPTY_LEDGER });

  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, ledger: EMPTY_LEDGER, locked: true });
  }

  try {
    const ledger = await getPriceLedgerCached(region);
    return NextResponse.json({ region, ledger });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/price-ledger]", region, msg);
    return NextResponse.json({ region, ledger: EMPTY_LEDGER, error: msg }, { status: 500 });
  }
}
