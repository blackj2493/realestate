/**
 * GET /api/market/inventory-history?region=<curated market>
 *
 * Daily active-inventory snapshots (active_count / stale% / median cap) for a curated
 * market, from market_summary_history (migration 064). Powers the Phase-2 inventory
 * time-series panel. Only the ~15 leaderboard markets have history; other regions return
 * an empty series (the panel then shows nothing).
 *
 * Derived STATISTICS (not listing rows). Thin consumer gate + cache wrapper. Mirrors
 * dom-distribution.
 */

import { NextRequest, NextResponse } from "next/server";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getInventoryHistoryCached, EMPTY_INVENTORY, type InventoryHistory } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic";

export type { InventoryHistory };

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  if (!region) return NextResponse.json({ region: "", inventory: EMPTY_INVENTORY });

  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, inventory: EMPTY_INVENTORY, locked: true });
  }

  try {
    const inventory = await getInventoryHistoryCached(region);
    return NextResponse.json({ region, inventory });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/inventory-history]", region, msg);
    return NextResponse.json({ region, inventory: EMPTY_INVENTORY, error: msg }, { status: 500 });
  }
}
