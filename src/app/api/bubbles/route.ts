/**
 * Market Bubbles API — user-owned saved custom areas, RLS-scoped via the cookie session.
 *
 *   GET  /api/bubbles                         → { items: Bubble[] }
 *   POST /api/bubbles    body: BubblePayload  → { item: Bubble }
 *
 * 401 when not signed in (sign-in gated by design — no anonymous fallback).
 * Per-account cap of 10 enforced by the BEFORE INSERT trigger in migration 025;
 * the trigger raises with code 'bubble_cap_reached' which we surface as 409.
 *
 * Mirrors src/app/api/watchlist/route.ts.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Bubble,
  BubbleAreaType,
  BubblePayload,
  BubbleSource,
} from "@/lib/bubbles/serialize";

export const dynamic = "force-dynamic";

const AREA_TYPES: readonly BubbleAreaType[] = ["draw", "commute", "school"];

function isLatLngArray(v: unknown): v is [number, number][] {
  return (
    Array.isArray(v) &&
    v.length >= 3 &&
    v.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === "number" &&
        typeof p[1] === "number"
    )
  );
}

function validatePayload(body: unknown):
  | { ok: true; payload: BubblePayload }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body required" };
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 80) return { ok: false, error: "name required (1-80 chars)" };

  const area_type = b.area_type as BubbleAreaType | undefined;
  if (!area_type || !AREA_TYPES.includes(area_type))
    return { ok: false, error: "area_type must be draw|commute|school" };

  if (!isLatLngArray(b.polygon))
    return { ok: false, error: "polygon must be [[lat,lng],...] with ≥3 points" };

  const source = b.source as BubbleSource | undefined;
  if (!source || typeof source !== "object")
    return { ok: false, error: "source required" };

  // We don't deeply validate filters — it's a passthrough JSONB blob owned by
  // the client. RLS plus the schema constraints are sufficient guardrails.
  return {
    ok: true,
    payload: {
      name,
      area_type,
      polygon: b.polygon as [number, number][],
      source,
      filters: (b.filters ?? null) as BubblePayload["filters"],
    },
  };
}

function rowToBubble(r: Record<string, unknown>): Bubble {
  return {
    id: r.id as string,
    name: r.name as string,
    area_type: r.area_type as BubbleAreaType,
    polygon: r.polygon as [number, number][],
    source: r.source as BubbleSource,
    filters: r.filters as BubblePayload["filters"],
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    // Alert fields (migration 034). Mapped optionally so a pre-034 database
    // (column absent from `select *`) still serializes — defaults to ON client-side.
    alerts_enabled: typeof r.alerts_enabled === "boolean" ? r.alerts_enabled : undefined,
    notify_since: (r.notify_since as string | null | undefined) ?? null,
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [], error: "unauthenticated" }, { status: 401 });

  // select * so the route works both before and after migration 034 adds the
  // alert columns (an explicit unknown column would 500 the whole list).
  const { data, error } = await supabase
    .from("market_bubbles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ items: [], error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data ?? []).map(rowToBubble) });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const v = validatePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const { data, error } = await supabase
    .from("market_bubbles")
    .insert({
      user_id: user.id,
      name: v.payload.name,
      area_type: v.payload.area_type,
      polygon: v.payload.polygon,
      source: v.payload.source,
      filters: v.payload.filters,
    })
    .select("*")
    .single();

  if (error) {
    // Trigger raises 'bubble_cap_reached' (10-per-user limit) — surface as 409
    // so the client can prompt the user to delete one before saving.
    if (error.message.includes("bubble_cap_reached")) {
      return NextResponse.json({ error: "bubble_cap_reached" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: rowToBubble(data as Record<string, unknown>) });
}
