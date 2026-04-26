/**
 * API Route: Trigger ETL Sync
 * 
 * Fire-and-forget endpoint to trigger the ingester sync from browser.
 * Returns immediately while sync runs in background.
 */

import { NextResponse } from "next/server";
import { runDeltaSync } from "@/scripts/worker/ingester";

export const dynamic = "force-dynamic";

export async function GET() {
  console.log('🔔 API Sync trigger received');
  
  // Fire-and-forget: start sync without awaiting
  // This prevents serverless timeout while sync runs in background
  runDeltaSync()
    .then(result => {
      console.log(`✅ Background sync completed: ${result.totalRecords} records synced`);
    })
    .catch(err => {
      console.error('❌ Background sync failed:', err.message);
    });
  
  // Return immediately with 200
  return NextResponse.json({
    success: true,
    message: "Sync job dispatched to background."
  });
}