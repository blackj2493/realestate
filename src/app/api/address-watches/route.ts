import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";
import { slugify } from "@/lib/listings/listingPath";
import { SENDERS } from "@/lib/alerts/senders";
import { SITE } from "@/lib/alerts/emailShell";
import { unsubscribeUrl } from "@/lib/alerts/unsubscribe";

export const dynamic = "force-dynamic";

/**
 * "Track this address" sign-up from the address-profile page (ADDRESS_PROFILES_PLAN P2).
 * Anonymous on purpose — mirrors /api/listing-alerts: the profile page serves visitors
 * whose address has NO listing (so listing_alerts' listing_key contract can't hold them).
 * Rows land in `address_watches` (migration 077, RLS service-only). The captured lead is
 * the value shipped here; delivery (matching new listings to watches in the nightly
 * worker) is the documented follow-up — same playbook listing_alerts shipped with.
 */
const limiter = makeRateLimiter({ windowMs: 60_000, max: 5 });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const POSTAL_RE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;
const MAX = { email: 254, address: 300, city: 120 };

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
    // Lowercased so the (email, address_key) unique index dedupes case variants.
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const address = typeof body?.address === "string" ? body.address.trim() : "";
    const city = typeof body?.city === "string" ? body.city.trim() : "";
    const postal =
      typeof body?.postal === "string" ? body.postal.replace(/\s+/g, "").toUpperCase() : "";
    const lat = typeof body?.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
    const lng = typeof body?.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;

    if (!EMAIL_RE.test(email) || email.length > MAX.email) return bad("Valid email is required");
    if (!address || address.length > MAX.address) return bad("Address is required");
    if (city.length > MAX.city) return bad("Field too long");
    if (postal && !POSTAL_RE.test(postal)) return bad("Invalid postal code");

    const addressKey = slugify(`${address} ${city}`);
    if (!addressKey) return bad("Address is required");

    const supabase = getServiceRoleClient();
    // Idempotent: re-tracking the same address with the same email is a no-op.
    const { error } = await supabase.from("address_watches").upsert(
      {
        email,
        address_key: addressKey,
        address,
        city: city || null,
        postal: postal || null,
        lat,
        lng,
      },
      { onConflict: "email,address_key", ignoreDuplicates: true }
    );
    if (error) {
      console.error("[address-watches] insert failed:", error.message);
      return NextResponse.json({ success: false, error: "Could not save your watch" }, { status: 500 });
    }

    // Best-effort confirmation — the DB row is the lead; email failure must not 500.
    try {
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const where = city ? `${address}, ${city}` : address;
        await resend.emails.send({
          from: SENDERS.confirmation.from,
          replyTo: SENDERS.confirmation.replyTo,
          to: email,
          subject: `Watching ${address} for you`,
          text:
            `You're tracking ${where} on PureProperty.\n\n` +
            `We'll email you if this address hits the market.\n\n` +
            `Didn't sign up? Ignore this email, or unsubscribe: ${unsubscribeUrl(email, SITE)}`,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl(email, SITE)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      }
    } catch (mailErr) {
      console.error("[address-watches] confirmation email failed (lead saved):", mailErr);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[address-watches]", e);
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
}
