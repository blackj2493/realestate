import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const listingKey = resolvedParams.id;

  try {
    console.log(`[Property API] Fetching listing: ${listingKey}`);
    
    const supabase = getServerClient();
    
    // Use timeout wrapper to prevent hanging
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Supabase query timeout')), 10000);
    });

    const queryPromise = supabase
      .from('listings')
      .select('*')
      .eq('listing_key', listingKey)
      .single();

    const { data: listing, error } = await Promise.race([queryPromise, timeoutPromise]);

    if (error) {
      console.log(`[Property API] Error: ${error.code} - ${error.message}`);
      
      if (error.code === 'PGRST116') {
        // Not found
        return NextResponse.json(
          { notFound: true, message: "Listing not found in database" },
          { status: 404 }
        );
      }
      
      throw error;
    }

    if (!listing) {
      return NextResponse.json(
        { notFound: true, message: "Listing not found" },
        { status: 404 }
      );
    }

    console.log(`[Property API] Found listing: ${listingKey}`);
    console.log(`[Property API] Has ${listing.media_urls?.length || 0} media URLs`);

    // Return the data in the format expected by the client
    return NextResponse.json({
      listing_key: listing.listing_key,
      full_payload: listing.full_payload,
      media_urls: listing.media_urls || [],
      city: listing.city,
      property_sub_type: listing.property_sub_type,
      synced_at: listing.synced_at,
    });
  } catch (error) {
    console.error("[Property API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // If it's a not found case from timeout, return 404
    if (errorMessage.includes('timeout')) {
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
