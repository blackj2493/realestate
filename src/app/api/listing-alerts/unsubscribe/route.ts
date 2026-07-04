import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { verifyUnsubscribe } from "@/lib/alerts/unsubscribe";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe for anonymous listing-alert emails. The link carries the email +
 * an HMAC signature (see @/lib/alerts/unsubscribe) — no login, no lookup token. Flips every
 * `listing_alerts` row for that email to `unsubscribed`. Supports:
 *   GET  — the human clicks the footer link → HTML confirmation page.
 *   POST — RFC 8058 List-Unsubscribe-Post (mail-client one-click) → 200 JSON.
 */

async function unsubscribe(email: string, sig: string): Promise<{ ok: boolean; count: number }> {
  const e = (email || "").trim().toLowerCase();
  if (!verifyUnsubscribe(e, sig || "")) return { ok: false, count: 0 };
  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("listing_alerts")
      .update({ status: "unsubscribed" })
      .eq("email", e)
      .eq("status", "active")
      .select("id");
    if (error) {
      console.error("[listing-alerts/unsubscribe] update failed:", error.message);
      return { ok: false, count: 0 };
    }
    return { ok: true, count: data?.length ?? 0 };
  } catch (err) {
    console.error("[listing-alerts/unsubscribe]", err);
    return { ok: false, count: 0 };
  }
}

function htmlPage(title: string, body: string, status = 200): NextResponse {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:64px auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;text-align:center;">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 8px;">${title}</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">${body}</p>
    <a href="https://www.pureproperty.ca/properties" style="display:inline-block;background:#0891b2;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;">Browse listings</a>
  </div>
</body></html>`;
  return new NextResponse(doc, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const e = req.nextUrl.searchParams.get("e") || "";
  const s = req.nextUrl.searchParams.get("s") || "";
  const r = await unsubscribe(e, s);
  if (!r.ok) {
    return htmlPage(
      "Link expired",
      "This unsubscribe link is invalid or has expired. If you keep getting emails, reply to one and we'll remove you.",
      400
    );
  }
  return htmlPage(
    "You're unsubscribed",
    "You won't receive any more listing alerts at this address. You can re-subscribe anytime from a listing page."
  );
}

export async function POST(req: NextRequest) {
  const e = req.nextUrl.searchParams.get("e") || "";
  const s = req.nextUrl.searchParams.get("s") || "";
  const r = await unsubscribe(e, s);
  return NextResponse.json({ success: r.ok }, { status: r.ok ? 200 : 400 });
}
