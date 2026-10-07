/**
 * POST /api/email/narrow-area   body: { e, s, city, action: "switch"|"keep"|"undo", part? }
 *
 * The buttons on /areas/narrow, the page the digest's narrow ask links to. A POST on purpose:
 * mail scanners open every link in an email, and this call REPLACES an area, so it must only
 * ever run from a reader pressing a button. The page itself (a GET) changes nothing.
 *
 * AUTH is the narrow-link HMAC (src/lib/areas/narrowLink.ts), signed over the email AND the
 * city, so a link for one reader's Toronto cannot touch anyone else's account or city.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { verifyNarrow } from "@/lib/areas/narrowLink";
import { parseNarrowInput, performNarrow } from "@/lib/areas/narrowAction";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = makeRateLimiter({ windowMs: 60_000, max: 12 });

export async function POST(req: NextRequest) {
  const rl = limiter.check(clientIpFrom(req));
  if (!rl.allowed) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.e === "string" ? body.e.trim().toLowerCase() : "";
  const sig = typeof body?.s === "string" ? body.s : "";
  const input = parseNarrowInput(body);
  if (!input) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (!verifyNarrow(email, input.city, sig)) {
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 403 });
  }

  const sb = getServiceRoleClient();
  const { data: profile } = await sb.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (!profile?.id) return NextResponse.json({ ok: false, error: "no_account" }, { status: 404 });

  const out = await performNarrow(sb, profile.id as string, input, { via: "email", email });
  if (!out.ok) {
    console.error("[email/narrow-area] failed:", out.error);
    return NextResponse.json({ ok: false, error: "write_failed" }, { status: 500 });
  }
  if (out.error) console.error("[email/narrow-area] alert reconcile:", out.error);
  return NextResponse.json({ ok: true, mapHref: out.mapHref });
}
