import { NextRequest, NextResponse } from "next/server";
import { getListingDetail, gateSaleHistory } from "@/lib/property/getListingDetail";
import { getCurrentUser } from "@/lib/supabase/server";

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

    // VOW gating: sold prices/dates are stripped for anonymous users (§4).
    const user = await getCurrentUser();
    const saleHistory = gateSaleHistory(detail.saleHistory, !!user);

    return NextResponse.json({
      listing_key: detail.listing_key,
      full_payload: detail.full_payload,
      media_urls: detail.media_urls,
      city: detail.city,
      property_sub_type: detail.property_sub_type,
      synced_at: detail.synced_at,
      estimate: detail.estimate,
      feeStability: detail.feeStability,
      dealScore: detail.dealScore,
      saleHistory,
      isAuthed: !!user,
      priceTimeline: detail.priceTimeline,
      rooms: detail.rooms,
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
