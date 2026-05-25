/**
 * POST /api/property/[id]/view — record a unique listing view and return live
 * social-proof counts.
 *
 * Honest tracking: one row per (listing_key, viewer_id), so a refresh or revisit
 * only bumps updated_at — it never inflates the unique-viewer count. Written/read
 * with the service-role client (the listing_views table is RLS-locked to it).
 *
 * Degrades gracefully: if the table doesn't exist yet (pre-migration) the counts
 * fall back to 0 and the caller simply renders nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

const MAX_VIEWER_ID = 64;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: listingKey } = await params;

  let viewerId = "";
  try {
    const body = await request.json();
    viewerId =
      typeof body?.viewerId === "string" ? body.viewerId.trim().slice(0, MAX_VIEWER_ID) : "";
  } catch {
    /* empty / invalid body */
  }

  if (!listingKey || !viewerId) {
    return NextResponse.json({ viewers: 0, watchers: 0 });
  }

  const supabase = getServiceRoleClient();

  // Record the view (dedup on listing_key + viewer_id; refresh bumps updated_at).
  await supabase
    .from("listing_views")
    .upsert(
      { listing_key: listingKey, viewer_id: viewerId, updated_at: new Date().toISOString() },
      { onConflict: "listing_key,viewer_id" }
    );

  // Unique viewers + how many have it on a watchlist (both honest, deduped counts).
  const [viewsRes, watchRes] = await Promise.all([
    supabase
      .from("listing_views")
      .select("*", { count: "exact", head: true })
      .eq("listing_key", listingKey),
    supabase
      .from("watchlist")
      .select("*", { count: "exact", head: true })
      .eq("listing_key", listingKey),
  ]);

  return NextResponse.json({
    viewers: viewsRes.count ?? 0,
    watchers: watchRes.count ?? 0,
  });
}
