/**
 * GET/PUT /api/dashboard-config — server-side home for the signed-in user's
 * DashboardConfig (migration 096), so saved areas / activity filters / persona
 * follow the account across devices instead of living per-browser.
 *
 * Sync model (see DashboardClient): server wins on load, last-writer-wins on
 * edit. The blob is stored as-is and NORMALIZED ON READ by the client
 * (normalizeConfig) — schema evolution stays in TypeScript, the API is dumb.
 * RLS (owner-only) does the authorization; this route just requires a session.
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Config blobs are small (<2 KB typical); reject anything absurd. */
const MAX_CONFIG_BYTES = 32_768;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("dashboard_prefs")
    .select("config, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data?.config ?? null, updated_at: data?.updated_at ?? null });
}

export async function PUT(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const raw = await req.text();
  if (raw.length > MAX_CONFIG_BYTES)
    return NextResponse.json({ error: "config too large" }, { status: 413 });
  let body: { config?: unknown } | null = null;
  try {
    body = JSON.parse(raw) as { config?: unknown };
  } catch {
    /* fall through */
  }
  if (!body || typeof body.config !== "object" || body.config === null)
    return NextResponse.json({ error: "body must be { config: object }" }, { status: 400 });

  const { error } = await supabase
    .from("dashboard_prefs")
    .upsert({ user_id: user.id, config: body.config, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
