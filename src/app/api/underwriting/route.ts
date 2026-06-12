/**
 * Underwriting scenarios API — user-owned, RLS-scoped via the cookie session.
 *
 *   GET    /api/underwriting?listing_key=...   → { scenarios: Scenario[] }
 *   POST   /api/underwriting   body: Scenario  → upsert one (by user+listing+name)
 *   DELETE /api/underwriting?id=...            → remove one
 *
 * 401 when not signed in (the client store falls back to localStorage).
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ScenarioBody {
  listing_key?: string;
  name?: string;
  assumptions?: unknown;
}

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ scenarios: [] }, { status: 401 });

  const listingKey = (new URL(req.url).searchParams.get("listing_key") ?? "").trim();

  // Defense-in-depth: filter by user_id explicitly so GET is symmetric with DELETE.
  // RLS already enforces this today; the explicit filter is an audit LOW-29 hardening.
  let query = supabase
    .from("underwriting_scenarios")
    .select("id, listing_key, name, assumptions, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (listingKey) query = query.eq("listing_key", listingKey);

  const { data, error } = await query;
  if (error) return NextResponse.json({ scenarios: [], error: error.message }, { status: 500 });

  return NextResponse.json({ scenarios: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as ScenarioBody | null;
  const key = (body?.listing_key ?? "").toString().trim();
  const name = (body?.name ?? "").toString().trim().slice(0, 120);
  if (!key) return NextResponse.json({ error: "listing_key required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!body?.assumptions || typeof body.assumptions !== "object") {
    return NextResponse.json({ error: "assumptions required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("underwriting_scenarios")
    .upsert(
      {
        user_id: user.id,
        listing_key: key,
        name,
        assumptions: body.assumptions,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,listing_key,name" }
    )
    .select("id, listing_key, name, assumptions, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, scenario: data });
}

export async function DELETE(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("underwriting_scenarios")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
