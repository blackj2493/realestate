import { NextResponse } from "next/server";
import { searchListings } from "@/lib/typesense/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    console.log('[Debug API] Starting search...');
    
    const result = await searchListings({
      query: '*',
      filters: {
        transactionType: "For Sale",
      },
      page: 1,
      perPage: 5,
    });
    
    console.log('[Debug API] Search complete:', {
      totalFound: result.totalFound,
      hits: result.listings.length,
      processingTimeMs: result.processingTimeMs
    });
    
    return NextResponse.json({
      success: true,
      totalFound: result.totalFound,
      hits: result.listings.length,
      processingTimeMs: result.processingTimeMs,
      firstFew: result.listings.slice(0, 2).map(l => ({
        id: l.id,
        address: l.UnparsedAddress,
        price: l.ListPrice,
        city: l.City,
        propertyType: l.PropertySubType,
        location: l.location
      }))
    });
  } catch (err) {
    console.error('[Debug API] Error:', err);
    return NextResponse.json({
      success: false,
      error: (err as Error).message
    }, { status: 500 });
  }
}