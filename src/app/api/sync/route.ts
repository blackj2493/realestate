import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { ProptXClient } from "@/lib/proptx/client";
import { processBatch } from "../../../../scripts/worker/sync";
import { listingCacheTag } from "@/lib/property/listingCacheTag";

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // single-listing quick-sync only; the full ETL runs via GitHub Actions cron

// TRREB MLS listing keys: one uppercase board letter + 6-9 digits (e.g. W12632618).
// Strict validation is the OData-injection guard — listingKey is interpolated into
// two $filter strings below, so nothing outside this shape may pass.
const LISTING_KEY_RE = /^[A-Z]\d{6,9}$/;

/**
 * Bust the cached listing detail + page after a successful quick-sync so the freshly
 * synced record is visible immediately (and evicts any cached not-found null). Best-
 * effort — a revalidation hiccup must never fail an otherwise-successful sync.
 */
function revalidateListing(listingKey: string): void {
  try {
    // Next 16: { expire: 0 } forces immediate expiration so a freshly quick-synced
    // listing (and any cached not-found null) is evicted at once, not stale-served.
    revalidateTag(listingCacheTag(listingKey), { expire: 0 });
    revalidatePath(`/properties/${listingKey}`);
  } catch (e) {
    console.warn(`[Quick-Sync] revalidate failed for ${listingKey}:`, e);
  }
}

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
      let mediaItems: unknown[] = [];
      try {
        const mediaResponse = await client.getMediaBatch(`ResourceRecordKey eq '${listingKey}'`);
        mediaItems = mediaResponse.value;

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

      // Attach media so transformListing derives media_urls / primaryImageUrl
      // exactly like the nightly ETL (it reads raw.media — audit HIGH-6).
      (prop as Record<string, unknown>).media = mediaItems;

      try {
        const result = await processBatch([prop]);
        if (result.supabase.failed > 0) {
          throw new Error(String(result.supabase.errors?.[0] ?? "supabase upsert failed"));
        }
        // processBatch swallows Typesense failures into result.typesense.failed
        // (no throw) — report honestly instead of claiming a full index write.
        // Don't fall back: Supabase already has the full record; the fallback
        // would write less. The nightly sync repairs the index.
        const typesenseOk = result.typesense.failed === 0;
        if (!typesenseOk) {
          console.warn(`[Quick-Sync] Supabase ok but Typesense write failed for ${listingKey} — nightly sync will repair the index.`);
        }
        console.log(`[Quick-Sync] Full pipeline synced listing: ${listingKey}`);
        revalidateListing(listingKey);
        return NextResponse.json({
          success: true,
          message: "Listing synced successfully",
          listingKey,
          mediaCount: mediaUrls.length,
          pipeline: typesenseOk ? "full" : "full-no-typesense",
        });
      } catch (pipelineErr) {
        // The full pipeline needs ETL env (e.g. TYPESENSE_ADMIN_API_KEY at the
        // Typesense step). Never let that break on-demand sync for a visitor —
        // degrade to the legacy minimal upsert; the nightly ETL repairs the rest.
        console.error(`[Quick-Sync] full pipeline failed for ${listingKey} — falling back to minimal upsert:`, pipelineErr);
      }

      // Fallback: legacy minimal upsert (pre-HIGH-6 behavior, kept as a floor)
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

      console.log(`[Quick-Sync] Successfully synced listing (minimal): ${listingKey}`);
      revalidateListing(listingKey);
      return NextResponse.json({
        success: true,
        message: "Listing synced successfully",
        listingKey,
        mediaCount: mediaUrls.length,
        pipeline: "fallback-minimal",
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
