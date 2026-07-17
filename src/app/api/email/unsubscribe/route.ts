/**
 * GET/POST /api/email/unsubscribe?e=<email>&s=<hmac>
 *
 * One-click marketing unsubscribe for REGISTERED users (CASL + RFC 8058). Every marketing
 * send (welcome, future nurture) embeds the recipient's HMAC-signed email — so there's no
 * login and no per-row token: we recompute the signature and, on a match, set
 * profiles.marketing_opt_out. Transactional mail (OTP, watchlist alerts the user actively
 * saved) is deliberately NOT gated by this flag.
 *
 * POST is the RFC 8058 "List-Unsubscribe=One-Click" target (mail clients call it directly,
 * no UI). GET returns a small confirmation page for a human clicking the footer link.
 */
import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { verifyUnsubscribe } from "@/lib/alerts/unsubscribe";

export const dynamic = "force-dynamic";

async function optOut(email: string, sig: string): Promise<boolean> {
  if (!verifyUnsubscribe(email, sig)) return false;
  const e = email.trim().toLowerCase();
  try {
    const sb = getServiceRoleClient();
    // Case-insensitive exact match on the stored email; idempotent.
    const { error } = await sb
      .from("profiles")
      .update({ marketing_opt_out: true, marketing_opt_out_at: new Date().toISOString() })
      .ilike("email", e);
    if (error) {
      console.error("[email/unsubscribe] update failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email/unsubscribe] threw:", err);
    return false;
  }
}

function confirmationPage(ok: boolean): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 20px;color:#0f172a;">
  <div style="font-size:16px;font-weight:700;">${ok ? "You're unsubscribed." : "This link couldn't be verified."}</div>
  <p style="color:#475569;font-size:14px;line-height:1.6;">${
    ok
      ? "You won't receive PureProperty marketing emails anymore. You'll still get any alerts you actively saved and account/security messages."
      : "Please use the unsubscribe link from a recent email, or manage your preferences from your dashboard."
  }</p>
  <a href="https://www.pureproperty.ca" style="color:#0891b2;text-decoration:none;font-weight:600;font-size:14px;">Back to PureProperty &rarr;</a>
</div>`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ok = await optOut(searchParams.get("e") || "", searchParams.get("s") || "");
  return new NextResponse(confirmationPage(ok), {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const ok = await optOut(searchParams.get("e") || "", searchParams.get("s") || "");
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
