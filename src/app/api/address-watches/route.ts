import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";
import { slugify } from "@/lib/listings/listingPath";
import { SENDERS } from "@/lib/alerts/senders";
import { sendTransactionalEmail } from "@/lib/alerts/sendEmail";
import { SITE } from "@/lib/alerts/emailShell";
import { unsubscribeUrl } from "@/lib/alerts/unsubscribe";
import { recordActivation } from "@/lib/analytics/activation";
import { isMissingRecapColumn, parseRecapChoice, watchConfirmationText } from "@/lib/alerts/addressWatchRequest";

export const dynamic = "force-dynamic";

/**
 * "Track this home" sign-up from the address pages (ADDRESS_PROFILES_PLAN P2).
 * Anonymous on purpose — mirrors /api/listing-alerts: the profile page serves visitors
 * whose address has NO listing (so listing_alerts' listing_key contract can't hold them).
 * Rows land in `address_watches` (migration 077, RLS service-only). Delivery is the
 * address-watch phase of the nightly alerts worker (scripts/worker/alerts.ts).
 *
 * `recap` (migration 155) is the visitor's answer to the monthly Street Recap tick-box —
 * see parseRecapChoice. Tracking a home again re-activates the watch (an explicit request
 * after an unsubscribe is fresh consent) and can switch the recap ON; it never switches
 * the recap off, because an unticked box on a second visit is not a decision. Turning it
 * off is the preference centre's job (/account/emails) or the unsubscribe link's.
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
    const recap = parseRecapChoice(body);

    const supabase = getServiceRoleClient();
    const row = {
      email,
      address_key: addressKey,
      address,
      city: city || null,
      postal: postal || null,
      lat,
      lng,
    };
    // Insert-only: an existing watch keeps its row (and its delivery baseline).
    const insert = (withRecap: boolean) => {
      const payload: Record<string, unknown> = withRecap && recap !== null ? { ...row, recap } : { ...row };
      return supabase
        .from("address_watches")
        .upsert(payload, { onConflict: "email,address_key", ignoreDuplicates: true });
    };
    let recapStored = true;
    let { error } = await insert(true);
    if (error && recap !== null && isMissingRecapColumn(error)) {
      // Migration 155 not applied yet: keep the watch, lose only the answer (the row stays
      // NULL = never asked, so it is not mailed a recap).
      console.warn("[address-watches] recap column missing — saved the watch without the answer");
      recapStored = false;
      ({ error } = await insert(false));
    }
    if (error) {
      console.error("[address-watches] insert failed:", error.message);
      return NextResponse.json({ success: false, error: "Could not save your watch" }, { status: 500 });
    }

    // A second "Track this home" on an existing row: re-activate it, and honour a tick.
    // A no-op for the row just inserted. Best-effort — the watch above already exists.
    const patch = recap === true && recapStored ? { status: "active", recap: true } : { status: "active" };
    const { error: patchError } = await supabase
      .from("address_watches")
      .update(patch)
      .eq("email", email)
      .eq("address_key", addressKey);
    if (patchError) console.error("[address-watches] re-activate failed:", patchError.message);

    // Activation milestone (0.3) — best-effort, never blocks the response.
    await recordActivation({
      kind: "watch_address",
      email,
      context: { address_key: addressKey, city: city || null },
    });

    // Best-effort confirmation — the DB row is the lead; email failure must not 500.
    // Observable + non-throwing (a missing/bad key is logged + recorded, not silent).
    const where = city ? `${address}, ${city}` : address;
    await sendTransactionalEmail({
      kind: "confirmation:address-watch",
      from: SENDERS.confirmation.from,
      replyTo: SENDERS.confirmation.replyTo,
      to: email,
      subject: `Watching ${address} for you`,
      text: watchConfirmationText({
        where,
        recap: recap === true && recapStored,
        unsubscribeUrl: unsubscribeUrl(email, SITE),
      }),
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl(email, SITE)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[address-watches]", e);
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
}
