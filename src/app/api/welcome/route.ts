/**
 * POST /api/welcome
 *
 * Sends the one-time welcome email. Called by <WelcomeOnSignup> on first
 * authenticated load, with the pre-signup search intent captured client-side.
 *
 * Idempotent: guarded by profiles.welcome_sent_at, so repeated calls (or a second
 * device) never double-send. Best-effort: never blocks the user; a Resend/Typesense
 * hiccup just leaves welcome_sent_at unset so the next load retries.
 *
 * Auth: the recipient is the SERVER-verified session user — never a body-supplied id.
 * Compliance: no VOW data in the email (active for-sale count only); CASL unsubscribe.
 *
 * Env: RESEND_API_KEY (Vercel), NEXT_PUBLIC_SITE_URL, (optional) ALERTS_FROM_EMAIL.
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getCurrentUser } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { getTypesenseClient } from "@/lib/typesense/client";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";
import { renderWelcomeEmail, type WelcomeIntent } from "@/lib/alerts/welcome";
import { signUnsubscribe } from "@/lib/email/token";

export const runtime = "nodejs";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const FROM = process.env.ALERTS_FROM_EMAIL || "PureProperty <support@pureproperty.ca>";
const limiter = makeRateLimiter({ windowMs: 60_000, max: 10 });

function sanitizeIntent(v: unknown): WelcomeIntent | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 80) : "";
  if (!label) return null;
  const slug = typeof o.slug === "string" ? o.slug.trim().slice(0, 80) : "";
  const prov = typeof o.prov === "string" ? o.prov.trim().slice(0, 4) : undefined;
  return { label, slug, prov };
}

/** Best-effort count of active (for-sale) listings in a city. null on any failure. */
async function countActiveInCity(label: string): Promise<number | null> {
  try {
    const ts = getTypesenseClient();
    const res = await ts
      .collections("properties")
      .documents()
      .search({ q: "*", query_by: "City", filter_by: `City:=\`${label.replace(/`/g, "")}\``, per_page: 1 });
    return typeof res.found === "number" ? res.found : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!limiter.check(clientIpFrom(req)).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  const user = await getCurrentUser();
  if (!user?.id) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine — generic welcome */
  }
  const bodyIntent = sanitizeIntent(body.intent);

  const sb = getServiceRoleClient();
  const { data: profile, error } = await sb
    .from("profiles")
    .select("email, full_name, welcome_sent_at, signup_intent, email_opt_out")
    .eq("id", user.id)
    .maybeSingle();

  // Profile is seeded synchronously by on_auth_user_created; if it's somehow not
  // there yet, don't set any flag — the next load retries.
  if (error || !profile) return NextResponse.json({ ok: false, reason: "no_profile" }, { status: 200 });
  if (profile.welcome_sent_at) return NextResponse.json({ ok: true, already: true });

  // Persist the captured intent (first one wins) regardless of send outcome.
  const effectiveIntent =
    bodyIntent ?? (sanitizeIntent(profile.signup_intent) as WelcomeIntent | null);
  if (bodyIntent && !profile.signup_intent) {
    await sb.from("profiles").update({ signup_intent: bodyIntent }).eq("id", user.id);
  }

  const markSent = () => sb.from("profiles").update({ welcome_sent_at: new Date().toISOString() }).eq("id", user.id);

  // Respect CASL opt-out: don't send, but mark so we stop trying.
  if (profile.email_opt_out) {
    await markSent();
    return NextResponse.json({ ok: true, skipped: "opted_out" });
  }

  const to = (profile.email as string) || user.email;
  if (!to) {
    await markSent(); // can never send without an address — don't loop.
    return NextResponse.json({ ok: true, skipped: "no_email" });
  }

  // No mailer configured → leave the watermark unset so it sends once RESEND is added.
  if (!process.env.RESEND_API_KEY) {
    console.warn("[welcome] RESEND_API_KEY not set — welcome email skipped (will retry).");
    return NextResponse.json({ ok: false, reason: "resend_unconfigured" }, { status: 200 });
  }

  const listingCount = effectiveIntent?.label ? await countActiveInCity(effectiveIntent.label) : null;
  const ctaUrl = effectiveIntent?.label
    ? `${SITE}/properties?search=${encodeURIComponent(effectiveIntent.label)}`
    : `${SITE}/properties`;
  const unsubscribeUrl = `${SITE}/api/email/unsubscribe?u=${encodeURIComponent(user.id)}&t=${signUnsubscribe(user.id)}`;

  const { subject, html, text } = renderWelcomeEmail({
    name: (profile.full_name as string) ?? null,
    intent: effectiveIntent,
    listingCount,
    siteUrl: SITE,
    ctaUrl,
    unsubscribeUrl,
  });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: FROM, to, subject, html, text });
  } catch (e) {
    console.error("[welcome] send failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: "send_failed" }, { status: 200 });
  }

  await markSent();
  return NextResponse.json({ ok: true, sent: true });
}
