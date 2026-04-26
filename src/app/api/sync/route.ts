import { NextResponse } from "next/server";
import { runDeltaSync } from "../../../../scripts/worker/ingester"; // Adjust relative path if needed

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Keep connection open up to 5 minutes

export async function GET() {
  try {
    console.log("🚦 API Trigger: Starting sync and holding connection open...");
    
    // CRITICAL FIX: We MUST await the sync. Do not fire-and-forget.
    const result = await runDeltaSync();
    
    return NextResponse.json({ 
      success: true, 
      message: "Sync completed.",
      result
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message || "Unknown error occurred"
    }, { status: 500 });
  }
}