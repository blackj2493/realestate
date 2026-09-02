/**
 * GET/PUT /api/dashboard-config — server-side home for the signed-in user's
 * DashboardConfig (migration 096), so saved areas / activity filters / persona
 * follow the account across devices instead of living per-browser.
 *
 * Sync model (see DashboardClient): server wins on load, and an edit must carry the
 * `updated_at` it was based on. A write based on an older copy is REFUSED (409) with the
 * current server copy attached, so the client adopts it instead of overwriting it.
 *
 * That check exists because the blob is written WHOLE. Under plain last-writer-wins a
 * second device only had to hold a stale copy — one failed GET is enough, since
 * `fetchServerConfig` returns `unavailable` and the device then keeps its local config —
 * and its next edit, even a lens tweak, silently deleted every area added on the first
 * device. Measured on prod 2026-09-01: an account whose dashboard listed 2 areas had 6
 * alerting `market_bubbles` rows, because the areas were erased from the blob while their
 * alert rows (not part of it) survived and kept emailing.
 *
 * The blob is otherwise stored as-is and NORMALIZED ON READ by the client
 * (normalizeConfig) — schema evolution stays in TypeScript, the API is dumb.
 * RLS (owner-only) does the authorization; this route just requires a session.
 *
 * The PUT also reconciles the account's new-listing alert rows against the areas it just
 * stored (reconcileCityAlerts). This is the one place every writer of `config.regions`
 * passes through, so it is the only place that can keep the two in step. Best-effort: a
 * reconcile failure is reported in the response but never fails the save.
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reconcileCityAlerts } from "@/lib/dashboard/areaAlertSync";

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
  let body: { config?: unknown; baseUpdatedAt?: string | null } | null = null;
  try {
    body = JSON.parse(raw) as { config?: unknown; baseUpdatedAt?: string | null };
  } catch {
    /* fall through */
  }
  if (!body || typeof body.config !== "object" || body.config === null)
    return NextResponse.json({ error: "body must be { config: object }" }, { status: 400 });

  // A client that omits `baseUpdatedAt` entirely is a bundle from before this shipped —
  // let it through unchecked rather than break every open tab on deploy day. `null` is NOT
  // the same thing: that is a client asserting "there is no row yet", which IS checkable.
  const checked = "baseUpdatedAt" in body;
  const base = body.baseUpdatedAt ?? null;
  const now = new Date().toISOString();

  const { data: current, error: readErr } = await supabase
    .from("dashboard_prefs")
    .select("config, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const stale = () =>
    NextResponse.json(
      { error: "stale", config: current?.config ?? null, updated_at: current?.updated_at ?? null },
      { status: 409 }
    );

  if (checked && current && current.updated_at !== base) return stale();
  if (checked && !current && base !== null) return stale();

  if (current) {
    // Conditional on the very `updated_at` we just read, so two writes that both passed
    // the check above cannot interleave and lose one of the two edits.
    const { data: updated, error } = await supabase
      .from("dashboard_prefs")
      .update({ config: body.config, updated_at: now })
      .eq("user_id", user.id)
      .eq("updated_at", current.updated_at)
      .select("updated_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (checked && (updated?.length ?? 0) === 0) return stale();
  } else {
    const { error } = await supabase
      .from("dashboard_prefs")
      .upsert({ user_id: user.id, config: body.config, updated_at: now });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const alerts = await reconcileCityAlerts(supabase, user.id, body.config);
  if (alerts.error) console.error("[dashboard-config] alert reconcile failed:", alerts.error);

  return NextResponse.json({ ok: true, updated_at: now, alerts });
}
