import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";
import { SENDERS } from "@/lib/alerts/senders";

export const dynamic = "force-dynamic";

/**
 * Listing-page email alert sign-up (conversion Phase 1). Anonymous on purpose: most
 * organic listing-page traffic is single-listing buyer intent that never creates an
 * account — this captures a re-engageable lead with ONE field (email), no signup. Rows
 * land in `listing_alerts` (RLS: service-only). Abuse contained by validation + per-IP cap.
 *
 * Mirrors /api/viewing-requests. The alert-DELIVERY pipeline (matching price/status changes
 * to these rows) is a follow-up; the captured lead is the value shipped here.
 */
const limiter = makeRateLimiter({ windowMs: 60_000, max: 5 });
const LISTING_KEY_RE = /^[A-Z]\d{6,9}$/;
// Same pragmatic shape as EMAIL_RE in /api/viewing-requests: one @, a dotted domain, ≥2 TLD.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = { email: 254, address: 300, city: 120 };

// Subscribe intents. `kind` is whitelisted; the confirmation copy is keyed off it.
const KIND_COPY: Record<string, { label: string; line: (where: string) => string }> = {
  price_status: {
    label: "Price & status alerts",
    line: (where) => `We'll email you if the price or status of ${where} changes.`,
  },
  relist: {
    label: "Relist alert",
    line: (where) => `We'll email you if ${where} comes back on the market.`,
  },
  similar: {
    label: "New-listing alerts",
    line: (where) => `We'll email you when homes like ${where} hit the market.`,
  },
};

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const rl = limiter.check(clientIpFrom(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = await req.json();
    const listingKey = typeof body?.listingKey === "string" ? body.listingKey.trim() : "";
    // Normalize the email to lowercase so the (listing_key, email, kind) unique index dedupes
    // case variants of the same address.
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const address = typeof body?.address === "string" ? body.address.trim() : "";
    const city = typeof body?.city === "string" ? body.city.trim() : "";
    const kind = typeof body?.kind === "string" && body.kind in KIND_COPY ? body.kind : "price_status";

    if (!LISTING_KEY_RE.test(listingKey)) return bad("Invalid listing key");
    if (!EMAIL_RE.test(email) || email.length > MAX.email) return bad("Valid email is required");
    if (address.length > MAX.address || city.length > MAX.city) return bad("Field too long");

    const supabase = getServiceRoleClient();
    // Idempotent: a repeat submit for the same (listing, email, kind) is a no-op, not an error.
    const { error } = await supabase.from("listing_alerts").upsert(
      {
        listing_key: listingKey,
        email,
        address: address || null,
        city: city || null,
        kind,
      },
      { onConflict: "listing_key,email,kind", ignoreDuplicates: true }
    );
    if (error) {
      console.error("[listing-alerts] insert failed:", error.message);
      return NextResponse.json({ success: false, error: "Could not save your alert" }, { status: 500 });
    }

    // Best-effort confirmation to the subscriber — the DB row is the lead; email failure must
    // not 500. Doubles as first-touch: gets our domain into their inbox with a concrete promise.
    try {
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const where = address || (city ? `homes in ${city}` : "this home");
        const copy = KIND_COPY[kind];
        await resend.emails.send({
          from: SENDERS.confirmation.from,
          replyTo: SENDERS.confirmation.replyTo,
          to: email,
          subject: `You're set — ${copy.label} for ${address || city || listingKey}`,
          text: [
            copy.line(where),
            "",
            "You'll only hear from us when something actually changes. Unsubscribe anytime from any alert email.",
            "",
            "— PureProperty.ca",
          ].join("\n"),
        });
      }
    } catch (mailErr) {
      console.error("[listing-alerts] confirmation email failed (lead saved):", mailErr);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[listing-alerts]", e);
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
}
