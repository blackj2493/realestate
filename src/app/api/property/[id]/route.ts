import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { calculateAVM } from "@/lib/avm/calculator";
import { mapListingToAVMInput } from "@/lib/avm/mapListingToAVMInput";
import type { AVMResult } from "@/lib/avm/types";
import {
  isCondo,
  buildFeeStabilityResult,
  type FeeStabilityResult,
  type AreaStats,
  type CorpStats,
  type TrendBucket,
} from "@/lib/condo/feeStability";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const listingKey = resolvedParams.id;

  try {
    console.log(`[Property API] Fetching listing: ${listingKey}`);
    
    // Use service role client to bypass RLS policies
    const supabase = getServiceRoleClient();
    
    // Use timeout wrapper to prevent hanging
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Supabase query timeout')), 10000);
    });

    const queryPromise = supabase
      .from('listings')
      .select('*')
      .eq('listing_key', listingKey)
      .maybeSingle();  // Returns null instead of throwing when no rows

    const { data: listing, error } = await Promise.race([queryPromise, timeoutPromise]);

    // Handle query errors (non-PGRST116 errors)
    if (error) {
      console.error(`[Property API] Supabase error for ${listingKey}:`, error.code, error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    // .maybeSingle() returns null when 0 rows found
    if (!listing) {
      console.log(`[Property API] Listing not found in database: ${listingKey}`);
      return NextResponse.json(
        { notFound: true, message: "Listing not found in database" },
        { status: 404 }
      );
    }

    console.log(`[Property API] Found listing: ${listingKey}`);
    console.log(`[Property API] Has ${listing.media_urls?.length || 0} media URLs`);

    // Best-effort PureProperty Estimate (AVM). Never blocks the listing response.
    let estimate: AVMResult | null = null;
    try {
      const avmInput = mapListingToAVMInput(listing.full_payload);
      if (avmInput) {
        const avmTimeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('AVM timeout')), 8000);
        });
        estimate = await Promise.race([calculateAVM(supabase, avmInput), avmTimeout]);
      }
    } catch (avmError) {
      console.error(`[Property API] AVM estimate failed for ${listingKey}:`, avmError);
    }

    // Best-effort Condo Fee Stability. Reads precomputed condo_fee_stats only (two
    // indexed point-lookups — never scans raw_vow_sold at request time). Never blocks.
    let feeStability: FeeStabilityResult = { available: false, trend: null };
    try {
      const payload = listing.full_payload as Record<string, unknown> | null;
      if (isCondo(payload)) {
        const cityRegion = String(payload?.["CityRegion"] ?? "").trim();
        const subType = String(payload?.["PropertySubType"] ?? "").trim();
        const corpRaw = payload?.["CondoCorpNumber"];
        const corpKey =
          corpRaw === null || corpRaw === undefined ? "" : String(corpRaw).trim();

        const [areaRes, corpRes] = await Promise.all([
          cityRegion && subType
            ? supabase
                .from("condo_fee_stats")
                .select("median_fee_psf, p25_fee_psf, p75_fee_psf, sample_count, inclusions_mixed")
                .eq("cohort_type", "area")
                .eq("cohort_key", cityRegion)
                .eq("property_sub_type", subType)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          corpKey && corpKey !== "0"
            ? supabase
                .from("condo_fee_stats")
                .select("trend_buckets, pct_change_24mo, sample_count, inclusions_mixed")
                .eq("cohort_type", "corp")
                .eq("cohort_key", corpKey)
                .eq("property_sub_type", "ALL")
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        const areaRow = areaRes.data as Record<string, unknown> | null;
        const area: AreaStats | null = areaRow
          ? {
              medianPsf: Number(areaRow.median_fee_psf),
              p25Psf: Number(areaRow.p25_fee_psf),
              p75Psf: Number(areaRow.p75_fee_psf),
              sampleCount: Number(areaRow.sample_count),
              inclusionsMixed: areaRow.inclusions_mixed === true,
            }
          : null;

        const corpRow = corpRes.data as Record<string, unknown> | null;
        const corp: CorpStats | null = corpRow
          ? {
              buckets: (corpRow.trend_buckets as TrendBucket[]) ?? [],
              pctChange24mo: Number(corpRow.pct_change_24mo),
              sampleCount: Number(corpRow.sample_count),
              inclusionsMixed: corpRow.inclusions_mixed === true,
            }
          : null;

        feeStability = buildFeeStabilityResult({ payload, cityRegion, area, corp });
      }
    } catch (feeError) {
      console.error(`[Property API] Fee stability failed for ${listingKey}:`, feeError);
    }

    // Return the data in the format expected by the client
    return NextResponse.json({
      listing_key: listing.listing_key,
      full_payload: listing.full_payload,
      media_urls: listing.media_urls || [],
      city: listing.city,
      property_sub_type: listing.property_sub_type,
      synced_at: listing.synced_at,
      estimate,
      feeStability,
    });
  } catch (error) {
    console.error("[Property API] Unexpected error:", error);
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
