/**
 * One-shot migration of an anonymous (localStorage) watchlist into the signed-in
 * user's account. Called by the client store right after sign-in. Idempotent:
 * existing rows are left untouched (ignoreDuplicates).
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface WatchBody {
  listing_key?: string;
  address?: string | null;
  city?: string | null;
  thumb?: string | null;
  list_price?: number | null;
  status?: string | null;
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { items?: WatchBody[] } | null;
  const items = Array.isArray(body?.items) ? body!.items : [];

  const rows = items
    .filter((it) => (it?.listing_key ?? "").toString().trim())
    .map((it) => {
      const price = Number(it.list_price);
      return {
        user_id: user.id,
        listing_key: it.listing_key!.toString().trim(),
        address: it.address ?? null,
        city: it.city ?? null,
        thumb: it.thumb ?? null,
        list_price: Number.isFinite(price) ? price : null,
        last_known_status: it.status ?? null,
      };
    });

  if (rows.length === 0) return NextResponse.json({ ok: true, migrated: 0 });

  const { error } = await supabase
    .from("watchlist")
    .upsert(rows, { onConflict: "user_id,listing_key", ignoreDuplicates: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, migrated: rows.length });
}
