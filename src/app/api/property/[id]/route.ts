import { NextRequest, NextResponse } from "next/server";
import { getListingDetail, gateVowDerived } from "@/lib/property/getListingDetail";
import { getCurrentUser } from "@/lib/supabase/server";
import { resolveSalePrice } from "@/lib/avm/salePrice";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const listingKey = resolvedParams.id;

  try {
    console.log(`[Property API] Fetching listing: ${listingKey}`);

    const detail = await getListingDetail(listingKey);

    if (!detail) {
      console.log(`[Property API] Listing not found in database: ${listingKey}`);
      return NextResponse.json(
        { notFound: true, message: "Listing not found in database" },
        { status: 404 }
      );
    }

    // VOW gating: strip sold prices/dates AND VOW-derived metrics (AVM, Deal Score,
    // stitched True DOM) for anonymous users; the terminal renders blurred teasers.
    // has* flags (from the ungated detail) tell the client where real data exists.
    const user = await getCurrentUser();
    const isAuthed = !!user;
    const hasEstimate = (detail.estimate?.estimatedValue ?? 0) > 0;
    const hasExpectedSale = (detail.expectedSale?.expectedPrice ?? 0) > 0;
    const hasDealScore = detail.dealScore.score !== null;
    const view = gateVowDerived(detail, isAuthed);

    // THE single price number (list-anchored where we can, AVM fallback). Resolved on the
    // GATED view → null for anon (inputs nulled); the client renders a locked teaser.
    const listPriceRaw = (view.full_payload as Record<string, unknown> | null)?.ListPrice;
    const listPrice = typeof listPriceRaw === "number" && listPriceRaw > 0 ? listPriceRaw : null;
    const salePrice = resolveSalePrice({
      listPrice,
      isActive: view.status.kind === "active",
      expectedSale: view.expectedSale,
      estimate: view.estimate,
    });

    return NextResponse.json({
      listing_key: view.listing_key,
      full_payload: view.full_payload,
      media_urls: view.media_urls,
      city: view.city,
      property_sub_type: view.property_sub_type,
      synced_at: view.synced_at,
      estimate: view.estimate,
      feeStability: view.feeStability,
      dealScore: view.dealScore,
      saleHistory: view.saleHistory,
      salePrice,
      isAuthed,
      hasEstimate,
      hasExpectedSale,
      hasDealScore,
      priceTimeline: view.priceTimeline,
      rooms: view.rooms,
    });
  } catch (error) {
    console.error("[Property API] Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // A query timeout most often means the listing isn't there — surface as 404
    // so the client can trigger an on-demand quick-sync (existing behavior).
    if (errorMessage.includes("timeout")) {
      return NextResponse.json(
        { notFound: true, message: "Database timeout - listing may not exist" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch listing", details: errorMessage },
      { status: 500 }
    );
  }
}
