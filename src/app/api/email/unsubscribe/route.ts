/**
 * GET/POST /api/email/unsubscribe?u=<userId>&t=<hmac>
 *
 * CASL one-click unsubscribe. GET renders a confirm page (a button posting back)
 * so an email client's link-prefetch can't silently opt someone out; POST verifies
 * the signed token and sets profiles.email_opt_out = true.
 *
 * The token is an HMAC of the user id (see src/lib/email/token.ts), so the link
 * can't be forged to unsubscribe an arbitrary account.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { verifyUnsubscribe } from "@/lib/email/token";

export const runtime = "nodejs";

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head>
  <body style="margin:0;background:#0f172a;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
    <div style="max-width:480px;margin:64px auto;padding:32px 24px;text-align:center;">
      <div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:24px;">PURE<span style="color:#38bdf8;">PROPERTY</span></div>
      ${body}
    </div>
  </body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  if (!verifyUnsubscribe(u, t)) {
    return page("Invalid link", `<p style="color:#94a3b8;">This unsubscribe link is invalid or expired.</p>`, 400);
  }
  const action = `/api/email/unsubscribe?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`;
  return page(
    "Unsubscribe",
    `<p style="font-size:15px;color:#cbd5e1;margin:0 0 24px;">Stop receiving PureProperty emails?</p>
     <form method="post" action="${action}">
       <button type="submit" style="background:#ef4444;color:#fff;font-weight:700;border:none;font-size:15px;padding:12px 28px;border-radius:8px;cursor:pointer;">Unsubscribe</button>
     </form>`
  );
}

export async function POST(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  if (!verifyUnsubscribe(u, t)) {
    return page("Invalid link", `<p style="color:#94a3b8;">This unsubscribe link is invalid or expired.</p>`, 400);
  }
  try {
    const sb = getServiceRoleClient();
    const { error } = await sb.from("profiles").update({ email_opt_out: true }).eq("id", u);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("[unsubscribe] failed:", e instanceof Error ? e.message : e);
    return page("Something went wrong", `<p style="color:#94a3b8;">Couldn't update your preferences. Please email support@pureproperty.ca.</p>`, 500);
  }
  return page(
    "Unsubscribed",
    `<p style="font-size:15px;color:#cbd5e1;">You've been unsubscribed from PureProperty emails.</p>
     <p style="font-size:13px;color:#64748b;margin-top:16px;">Changed your mind? Manage this anytime from your account settings.</p>`
  );
}
