/**
 * Watchlist API — user-owned, RLS-scoped via the cookie session.
 *
 *   GET    /api/watchlist                      → { items: WatchItem[] }
 *   POST   /api/watchlist        body: WatchItem → upsert one
 *   DELETE /api/watchlist?listing_key=...       → remove one
 *
 * 401 when not signed in (the client store falls back to localStorage).
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordActivation } from "@/lib/analytics/activation";

export const dynamic = "force-dynamic";

interface WatchBody {
  listing_key?: string;
  address?: string | null;
  city?: string | null;
  thumb?: string | null;
  list_price?: number | null;
  status?: string | null;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [], error: "unauthenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("watchlist")
    .select("listing_key, address, city, thumb, list_price, last_known_status, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ items: [], error: error.message }, { status: 500 });

  const items = (data ?? []).map((r) => ({
    listing_key: r.listing_key,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    thumb: r.thumb ?? undefined,
    list_price: r.list_price ?? undefined,
    status: r.last_known_status ?? undefined,
  }));
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as WatchBody | null;
  const key = (body?.listing_key ?? "").toString().trim();
  if (!key) return NextResponse.json({ error: "listing_key required" }, { status: 400 });

  const price = Number(body?.list_price);
  const { error } = await supabase.from("watchlist").upsert(
    {
      user_id: user.id,
      listing_key: key,
      address: body?.address ?? null,
      city: body?.city ?? null,
      thumb: body?.thumb ?? null,
      list_price: Number.isFinite(price) ? price : null,
      last_known_status: body?.status ?? null,
    },
    { onConflict: "user_id,listing_key" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Activation milestone (0.3) — best-effort, never blocks the response.
  await recordActivation({
    kind: "save_listing",
    userId: user.id,
    context: { listing_key: key },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const key = (new URL(req.url).searchParams.get("listing_key") ?? "").trim();
  if (!key) return NextResponse.json({ error: "listing_key required" }, { status: 400 });

  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("user_id", user.id)
    .eq("listing_key", key);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
