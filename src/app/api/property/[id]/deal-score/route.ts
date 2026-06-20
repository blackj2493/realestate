/**
 * GET /api/property/[id]/deal-score — slim, deal-score-only slice of getListingDetail.
 *
 * The Command Center Quick Look drawer calls this so its Deal Score + Estimated Sale
 * match the full report EXACTLY (same engine, same AVM-anchored inputs, same gating),
 * without pulling the heavy bundle (media, rooms, sale history) the full /api/property/[id]
 * route returns. Everything else in the drawer stays zero-fetch.
 */

import { NextRequest, NextResponse } from "next/server";
import { getListingDetail, gateVowDerived } from "@/lib/property/getListingDetail";
import { getCurrentUser } from "@/lib/supabase/server";
import { resolveSalePrice } from "@/lib/avm/salePrice";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const detail = await getListingDetail(id);
    if (!detail) {
      return NextResponse.json({ notFound: true }, { status: 404 });
    }

    // VOW gating mirrors /api/property/[id]: VOW-derived metrics (AVM, Deal Score) are
    // stripped for anonymous users; the has* flags (from the UNGATED detail) tell the
    // client where real data exists so it can render a locked teaser.
    const user = await getCurrentUser();
    const isAuthed = !!user;
    const hasEstimate = (detail.estimate?.estimatedValue ?? 0) > 0;
    const hasExpectedSale = (detail.expectedSale?.expectedPrice ?? 0) > 0;
    const hasDealScore = detail.dealScore.score !== null;
    const view = gateVowDerived(detail, isAuthed);

    const listPriceRaw = (view.full_payload as Record<string, unknown> | null)?.ListPrice;
    const listPrice = typeof listPriceRaw === "number" && listPriceRaw > 0 ? listPriceRaw : null;
    const salePrice = resolveSalePrice({
      listPrice,
      isActive: view.status.kind === "active",
      expectedSale: view.expectedSale,
      estimate: view.estimate,
    });

    return NextResponse.json({
      dealScore: view.dealScore,
      estimate: view.estimate,
      salePrice,
      isAuthed,
      hasDealScore,
      hasEstimate,
      hasExpectedSale,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg.includes("timeout")) {
      return NextResponse.json({ notFound: true }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to fetch deal score", details: msg }, { status: 500 });
  }
}
