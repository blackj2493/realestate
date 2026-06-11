import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { ProptXClient } from "@/lib/proptx/client";

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // single-listing quick-sync only; the full ETL runs via GitHub Actions cron

// TRREB MLS listing keys: one uppercase board letter + 6-9 digits (e.g. W12632618).
// Strict validation is the OData-injection guard — listingKey is interpolated into
// two $filter strings below, so nothing outside this shape may pass.
const LISTING_KEY_RE = /^[A-Z]\d{6,9}$/;

/**
 * POST /api/sync - Handle quick-sync requests for individual listings
 *
 * Body: { action: 'quick-sync', listingKey: string } (a 'priority' field is accepted and ignored)
 *
 * This is used when a property detail page can't find a listing in Supabase
 * and needs to trigger an immediate sync for that specific listing.
 * NOTE: the unauthenticated GET full-ETL trigger was removed 2026-06-09
 * (audit CRITICAL-6) — the nightly sync runs scripts/worker/ingester.ts via cron.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, listingKey } = body;

    if (action === 'quick-sync' && listingKey) {
      if (typeof listingKey !== 'string' || !LISTING_KEY_RE.test(listingKey)) {
        return NextResponse.json(
          { success: false, error: "Invalid listingKey format" },
          { status: 400 }
        );
      }
      console.log(`[Quick-Sync] Received request for listing: ${listingKey}`);

      // Use the VOW token to fetch the specific listing
      const vowToken = process.env.PROPTX_VOW_TOKEN;
      if (!vowToken) {
        return NextResponse.json({
          success: false,
          error: "VOW token not configured"
        }, { status: 500 });
      }

      const client = new ProptXClient(vowToken, "VOW");

      // Fetch the specific listing from ProptX
      const filterString = `ListingKey eq '${listingKey}'`;
      const properties = await client.getProperties({
        $top: 1,
        $filter: filterString,
      });

      if (!properties.value || properties.value.length === 0) {
        return NextResponse.json({
          success: false,
          error: "Listing not found in ProptX API"
        }, { status: 404 });
      }

      const prop = properties.value[0];

      // Fetch media for this listing
      let mediaUrls: string[] = [];
      try {
        const mediaResponse = await client.getMediaBatch(`ResourceRecordKey eq '${listingKey}'`);

        // Prefer Largest or Large images
        const sizePriority: Record<string, number> = {
          'Largest': 0,
          'Large': 1,
          'Medium': 2,
          'Small': 3
        };

        const sortedMedia = [...mediaResponse.value].sort((a, b) => {
          const priorityA = sizePriority[a.ImageSizeDescription || 'Small'] ?? 4;
          const priorityB = sizePriority[b.ImageSizeDescription || 'Small'] ?? 4;
          return priorityA - priorityB;
        });

        mediaUrls = sortedMedia.map(m => m.MediaURL).filter(Boolean);
      } catch (mediaError) {
        console.warn(`[Quick-Sync] Failed to fetch media for ${listingKey}:`, mediaError);
      }

      // Upsert to Supabase
      const supabase = getServiceRoleClient();
      const { error: upsertError } = await supabase
        .from('listings')
        .upsert({
          listing_key: listingKey,
          full_payload: prop as unknown as Record<string, unknown>,
          media_urls: mediaUrls,
          derived_metrics: {
            isDistressed: false,
            calculatedDOM: prop.DaysOnMarket || 0,
          },
          needs_geocoding: false,
          city: prop.City || null,
          property_sub_type: prop.PropertySubType || null,
          updated_at: new Date().toISOString(),
          synced_at: new Date().toISOString(),
        }, { onConflict: 'listing_key' });

      if (upsertError) {
        console.error(`[Quick-Sync] Failed to upsert ${listingKey}:`, upsertError);
        return NextResponse.json({
          success: false,
          error: upsertError.message
        }, { status: 500 });
      }

      console.log(`[Quick-Sync] Successfully synced listing: ${listingKey}`);
      return NextResponse.json({
        success: true,
        message: "Listing synced successfully",
        listingKey,
        mediaCount: mediaUrls.length,
      });
    }

    return NextResponse.json({
      success: false,
      error: "Unknown action or missing parameters"
    }, { status: 400 });
  } catch (error) {
    console.error("[Quick-Sync] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred"
    }, { status: 500 });
  }
}
