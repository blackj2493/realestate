/**
 * Per-bubble routes: read / rename / update / delete one saved market bubble.
 *
 *   GET    /api/bubbles/[id]
 *   PATCH  /api/bubbles/[id]  body: { name?, filters?, polygon?, source? }
 *   DELETE /api/bubbles/[id]
 *
 * RLS owner-only — auth.uid() must match user_id (migration 025). 401 when not
 * signed in, 404 when the row exists but isn't yours (PostgREST returns zero
 * rows under RLS rather than 403; we surface that as 404).
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

  // select * keeps this route working before and after migration 034 adds the
  // alert columns (an explicit unknown column would 500 the read).
  const { data, error } = await supabase
    .from("market_bubbles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item: data });
}

interface PatchBody {
  name?: string;
  filters?: unknown;
  polygon?: [number, number][];
  source?: unknown;
  /** Nightly new-listing digest toggle (migration 034). */
  alerts_enabled?: boolean;
  /** Digest match scope: 'all' | 'filtered' (migration 095). */
  alert_scope?: string;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (!n || n.length > 80)
      return NextResponse.json({ error: "name must be 1-80 chars" }, { status: 400 });
    patch.name = n;
  }
  if (body.filters !== undefined) patch.filters = body.filters;
  if (body.polygon !== undefined) {
    if (
      !Array.isArray(body.polygon) ||
      body.polygon.length < 3 ||
      !body.polygon.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          typeof p[0] === "number" &&
          typeof p[1] === "number"
      )
    ) {
      return NextResponse.json({ error: "polygon must be [[lat,lng],...] with ≥3 points" }, { status: 400 });
    }
    patch.polygon = body.polygon;
  }
  if (body.source !== undefined) patch.source = body.source;
  if (body.alerts_enabled !== undefined) {
    if (typeof body.alerts_enabled !== "boolean")
      return NextResponse.json({ error: "alerts_enabled must be boolean" }, { status: 400 });
    patch.alerts_enabled = body.alerts_enabled;
  }
  if (body.alert_scope !== undefined) {
    if (body.alert_scope !== "all" && body.alert_scope !== "filtered")
      return NextResponse.json({ error: "alert_scope must be 'all' or 'filtered'" }, { status: 400 });
    patch.alert_scope = body.alert_scope;
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "no updatable fields supplied" }, { status: 400 });

  const { data, error } = await supabase
    .from("market_bubbles")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { error } = await supabase.from("market_bubbles").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
