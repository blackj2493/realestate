/**
 * GET /api/market/avm-reliability?region=<city|neighbourhood>
 *
 * Sales-weighted AVM confidence (R² + MAE%) for a market area, via
 * region_avm_reliability() (migration 062): avm_audit_report cohorts mapped
 * neighbourhood→city via listings. Powers the Phase-2 "Estimate Confidence" panel.
 *
 * Derived STATISTICS (not listing rows). Thin consumer gate + cache wrapper. Mirrors
 * dom-distribution.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getAvmReliabilityCached, EMPTY_AVM, type AvmReliability } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic";

export type { AvmReliability };

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  const typeKeys = parseTypeKeys(params);
  if (!region) return NextResponse.json({ region: "", avm: EMPTY_AVM });

  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, avm: EMPTY_AVM, locked: true });
  }

  try {
    const avm = await getAvmReliabilityCached(region, typeKeys);
    return NextResponse.json({ region, avm });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/avm-reliability]", region, msg);
    return NextResponse.json({ region, avm: EMPTY_AVM, error: msg }, { status: 500 });
  }
}
