/**
 * GET/PUT /api/email-prefs — the signed-in user's granular email preferences
 * (migration 106), the store behind the preference center (engagement plan WS4.1).
 *
 * RLS owner-only, so this uses the cookie-session client (like /api/dashboard-config).
 * The per-stream toggles + cadence + pause live in `email_prefs`; the MASTER unsubscribe
 * (profiles.marketing_opt_out) is surfaced here too so the user can see and flip it in one
 * place. A missing email_prefs row means "all streams on at standard cadence" (opt-out
 * model) — GET returns those defaults so the UI always has a complete state to render.
 */
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CADENCES = ["standard", "reduced", "minimal"] as const;
type Cadence = (typeof CADENCES)[number];

interface EmailPrefsState {
  onboarding: boolean;
  alerts: boolean;
  data_drop: boolean;
  home_value: boolean;
  product: boolean;
  cadence: Cadence;
  pause_until: string | null;
  /** From profiles — the master one-click unsubscribe. */
  marketing_opt_out: boolean;
}

const DEFAULTS: Omit<EmailPrefsState, "marketing_opt_out"> = {
  onboarding: true,
  alerts: true,
  data_drop: true,
  home_value: true,
  product: true,
  cadence: "standard",
  pause_until: null,
};

const BOOL_KEYS = ["onboarding", "alerts", "data_drop", "home_value", "product"] as const;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [{ data: prefs }, { data: profile }] = await Promise.all([
    supabase
      .from("email_prefs")
      .select("onboarding, alerts, data_drop, home_value, product, cadence, pause_until")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("marketing_opt_out").eq("id", user.id).maybeSingle(),
  ]);

  const state: EmailPrefsState = {
    ...DEFAULTS,
    ...(prefs ?? {}),
    marketing_opt_out: profile?.marketing_opt_out === true,
  };
  return NextResponse.json({ prefs: state });
}

export async function PUT(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Partial<EmailPrefsState> | null;
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "body required" }, { status: 400 });

  // Build the email_prefs patch from whichever fields were supplied (validated).
  const patch: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const k of BOOL_KEYS) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== "boolean")
        return NextResponse.json({ error: `${k} must be boolean` }, { status: 400 });
      patch[k] = body[k];
    }
  }
  if (body.cadence !== undefined) {
    if (!CADENCES.includes(body.cadence as Cadence))
      return NextResponse.json({ error: "cadence must be standard|reduced|minimal" }, { status: 400 });
    patch.cadence = body.cadence;
  }
  if (body.pause_until !== undefined) {
    if (body.pause_until !== null) {
      const t = Date.parse(body.pause_until);
      if (Number.isNaN(t))
        return NextResponse.json({ error: "pause_until must be an ISO date or null" }, { status: 400 });
    }
    patch.pause_until = body.pause_until;
  }

  const { error } = await supabase.from("email_prefs").upsert(patch, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Master unsubscribe lives on profiles — flip it here too when supplied (lets the user
  // re-subscribe after a one-click unsubscribe, or turn everything off in one place).
  if (typeof body.marketing_opt_out === "boolean") {
    const { error: pErr } = await supabase
      .from("profiles")
      .update({
        marketing_opt_out: body.marketing_opt_out,
        marketing_opt_out_at: body.marketing_opt_out ? new Date().toISOString() : null,
      })
      .eq("id", user.id);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
