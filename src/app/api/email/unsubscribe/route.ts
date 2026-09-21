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
 *
 * BOTH OPT OUT IMMEDIATELY AND UNCONDITIONALLY. The GET path now offers two ways back on
 * the page it renders afterwards, but it offers them AFTER the write, never instead of it —
 * see confirmationPage. A page that asked "are you sure?" before honouring an unsubscribe
 * would be a worse product and a worse compliance position, and it is not what this does.
 */
import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { emailActionUrl, verifyUnsubscribe } from "@/lib/alerts/unsubscribe";
import { SITE } from "@/lib/alerts/emailShell";

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

/**
 * The confirmation page, which is now also the recovery page.
 *
 * THE UNSUBSCRIBE HAS ALREADY HAPPENED by the time this renders. Nothing here is a
 * confirmation step and nothing is withheld pending a second click — CASL asks that the
 * mechanism be readily performed, and the RFC 8058 one-click POST never reaches this
 * function at all. What changed is only what the page says afterwards.
 *
 * WHY IT NOW SAYS ANYTHING. Over the eight days after the in-email controls shipped, 14
 * readers unsubscribed, 2 paused and 0 switched to weekly. The controls are not broken —
 * both pauses landed — they sit at the bottom of a long email while the mail client renders
 * its own Unsubscribe beside the sender name, which is a surface this codebase cannot
 * reach. Someone who wants less mail and someone who wants none press the identical button,
 * and this page is the only place that can tell them apart. It used to answer with a link
 * to the homepage.
 *
 * The offer is deliberately narrow: one email a week, or the nightly one back. Not a
 * preference centre, not a survey, not a retention plea. Two links, and the door left open.
 */
function confirmationPage(ok: boolean, recovery: { weekly: string; daily: string } | null): string {
  const option = (href: string, label: string, sub: string) =>
    `<a href="${href}" style="display:block;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-top:10px;text-decoration:none;">
       <span style="display:block;color:#0e7490;font-weight:600;font-size:14px;">${label}</span>
       <span style="display:block;color:#64748b;font-size:12px;margin-top:2px;">${sub}</span>
     </a>`;

  const offer =
    ok && recovery
      ? `<p style="color:#475569;font-size:13px;line-height:1.6;margin-top:28px;">If it was the amount rather than the emails themselves, either of these puts you back on:</p>
         ${option(recovery.weekly, "Send it once a week instead", "One email with the best of the week in your areas.")}
         ${option(recovery.daily, "Go back to a nightly email", "The day&rsquo;s picks each morning, as before.")}`
      : "";

  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 20px;color:#0f172a;">
  <div style="font-size:16px;font-weight:700;">${ok ? "You're unsubscribed." : "This link couldn't be verified."}</div>
  <p style="color:#475569;font-size:14px;line-height:1.6;">${
    ok
      ? "You won't receive PureProperty marketing emails anymore. You'll still get any alerts you actively saved and account/security messages."
      : "Please use the unsubscribe link from a recent email, or manage your preferences from your dashboard."
  }</p>
  ${offer}
  <a href="https://www.pureproperty.ca" style="display:inline-block;margin-top:24px;color:#0891b2;text-decoration:none;font-weight:600;font-size:14px;">Back to PureProperty &rarr;</a>
</div>`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("e") || "";
  const ok = await optOut(email, searchParams.get("s") || "");
  // Signed per-action, like every other one-click link: the action is inside the HMAC, so a
  // recovery link cannot be edited into any other action for this address. Only built after
  // a VERIFIED opt-out, so this page never hands out a resubscribe link for an address
  // whose signature did not check out.
  const recovery = ok
    ? {
        weekly: emailActionUrl(email, "resub_weekly", SITE),
        daily: emailActionUrl(email, "resub_daily", SITE),
      }
    : null;
  return new NextResponse(confirmationPage(ok, recovery), {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const ok = await optOut(searchParams.get("e") || "", searchParams.get("s") || "");
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
