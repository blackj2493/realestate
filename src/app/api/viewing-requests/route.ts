import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";
import { sendLeadFollowUp } from "@/lib/alerts/leadFollowUpEmail";

export const dynamic = "force-dynamic";

// Lead capture from the listing page (audit MEDIUM-17). Anonymous on purpose —
// visitors requesting viewings ARE the product's leads. Abuse contained by
// validation + per-IP rate cap; rows land in viewing_requests (RLS: service-only).
const limiter = makeRateLimiter({ windowMs: 60_000, max: 3 });
const LISTING_KEY_RE = /^[A-Z]\d{6,9}$/;
// Pragmatic strict-enough email shape: one @, a dot in the domain, ≥2-char TLD.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = { name: 120, email: 254, phone: 40, preferredTime: 200, message: 2000, address: 300 };
// CTA-ladder intents. All route to this one pipeline; the label tags the email subject
// and is prepended to the stored message, so no new table/column is needed.
const INTENT_LABELS: Record<string, string> = {
  viewing: "Viewing request",
  question: "Question",
  price_opinion: "Price second-opinion",
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
    const listingKey = typeof body?.listingKey === "string" ? body.listingKey : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const preferredTime = typeof body?.preferredTime === "string" ? body.preferredTime.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const address = typeof body?.address === "string" ? body.address.trim() : "";
    const intent =
      typeof body?.intent === "string" && body.intent in INTENT_LABELS ? body.intent : "viewing";
    const leadLabel = INTENT_LABELS[intent];
    // Non-viewing intents tag the message so the lead type survives without a schema change.
    const taggedMessage =
      intent === "viewing" ? message || null : `[${leadLabel}]${message ? ` ${message}` : ""}`;

    if (!LISTING_KEY_RE.test(listingKey)) return bad("Invalid listing key");
    if (!name || name.length > MAX.name) return bad("Name is required");
    if (!EMAIL_RE.test(email) || email.length > MAX.email) return bad("Valid email is required");
    if (phone.length > MAX.phone || preferredTime.length > MAX.preferredTime) return bad("Field too long");
    if (message.length > MAX.message || address.length > MAX.address) return bad("Field too long");

    const supabase = getServiceRoleClient();
    const { error } = await supabase.from("viewing_requests").insert({
      listing_key: listingKey,
      address: address || null,
      name,
      email,
      phone: phone || null,
      preferred_time: preferredTime || null,
      message: taggedMessage,
    });
    if (error) {
      console.error("[viewing-requests] insert failed:", error.message);
      return NextResponse.json({ success: false, error: "Could not save request" }, { status: 500 });
    }

    // Best-effort owner notification — the DB row is the lead; email failure must not 500.
    try {
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const to = process.env.VIEWING_REQUESTS_EMAIL || process.env.ALERTS_FROM_EMAIL || "support@pureproperty.ca";
        const from = process.env.ALERTS_FROM_EMAIL || "support@pureproperty.ca";
        await resend.emails.send({
          from,
          to,
          replyTo: email,
          subject: `${leadLabel} — ${address || listingKey}`,
          text: [
            `Listing: ${listingKey}${address ? ` — ${address}` : ""}`,
            `Name: ${name}`,
            `Email: ${email}`,
            phone && `Phone: ${phone}`,
            preferredTime && `Preferred time: ${preferredTime}`,
            message && `Message: ${message}`,
          ].filter(Boolean).join("\n"),
        });
      }
    } catch (mailErr) {
      console.error("[viewing-requests] notification email failed (lead saved):", mailErr);
    }

    // Tier-0 speed-to-lead: instant auto-acknowledgement TO the lead (best-effort; a
    // follow-up failure must never fail the capture). This is the reply the lead used to
    // never get. `message` intentionally omitted from the reply — it's their own words.
    try {
      await sendLeadFollowUp({ name, address, listingKey, email });
    } catch (fuErr) {
      console.error("[viewing-requests] lead follow-up failed (lead saved):", fuErr);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[viewing-requests]", e);
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
}
