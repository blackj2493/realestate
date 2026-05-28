/**
 * GET /api/bubbles/[id]/stats
 *
 * Live active-side aggregates for one user's saved market bubble. RLS-scoped:
 * 401 when not signed in, 404 when the bubble isn't yours.
 *
 * Cached for 5 min keyed on the bubble id. The 10-per-user bubble cap
 * (migration 025) bounds total cardinality, so even worst-case all-users-poll
 * fan-out is small. We don't cache for longer because price/inventory changes
 * should reflect on the dashboard the same day they ship through the nightly
 * sync.
 *
 * Math lives in src/lib/bubbles/stats.ts (computeBubbleStats) — pure server
 * function, separately testable. This route only handles auth, fetch, cache.
 */

import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Bubble } from "@/lib/bubbles/serialize";
import { computeBubbleStats, type BubbleStats } from "@/lib/bubbles/stats";

export const dynamic = "force-dynamic"; // cache handled by unstable_cache per id

const EMPTY: BubbleStats = {
  activeCount: 0,
  medianListPrice: null,
  minListPrice: null,
  maxListPrice: null,
  medianCapRate: null,
  capRateSample: 0,
  staleCount: 0,
  sampled: false,
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("market_bubbles")
    .select("id, name, area_type, polygon, source, filters, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bubble = data as unknown as Bubble;

  try {
    const stats = await unstable_cache(
      () => computeBubbleStats(bubble),
      ["bubble-stats", bubble.id, bubble.updated_at],
      { revalidate: 300 }
    )();
    return NextResponse.json({ stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[bubbles/stats]", bubble.id, msg);
    return NextResponse.json({ stats: EMPTY, error: msg }, { status: 500 });
  }
}
