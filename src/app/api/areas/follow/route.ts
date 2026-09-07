/**
 * POST /api/areas/follow   body: { region: string }
 *
 * The in-app half of "follow a market". `/api/email/follow-market` does the same thing for
 * a reader clicking a chip in the Weekly Data Drop; this one serves AreaFollowPrompt, the
 * banner shown to a signed-in account that has no area at all.
 *
 * Both exist because those accounts cannot be reached any other way. An account with no
 * `alerts_enabled` city row and no watchlist row gets no digest, ever — and no backfill can
 * invent an area nobody ever chose. The email chip reaches the ones who still open mail;
 * this reaches the ones who still open the app. 305 of 432 accounts had no saved area when
 * the chip was written.
 *
 * Session-authed via RLS (not the HMAC the email chip needs), and a POST rather than that
 * route's GET: there is no mail scanner to survive here, so the safer verb is free.
 *
 * The write itself lives in followRegion so the two routes cannot drift — which is the bug
 * this repo keeps re-finding whenever `config.regions` gains another writer.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { followRegion } from "@/lib/dashboard/followRegion";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A human taps one chip. This is generous for a change of mind and hostile to a script
// walking the region list to flood a row per second.
const limiter = makeRateLimiter({ windowMs: 60_000, max: 12 });

export async function POST(req: NextRequest) {
  const rl = limiter.check(clientIpFrom(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { region?: unknown } | null;

  const result = await followRegion(supabase, user.id, body?.region, { source: "prompt" });
  if (!result.ok) {
    // An unusable region is the client's bug (400); anything else is ours (500).
    const status = result.error === "region_invalid" ? 400 : 500;
    if (status === 500) console.error("[areas/follow] write failed:", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  if (result.error) console.error("[areas/follow] alert reconcile failed:", result.error);

  return NextResponse.json({
    ok: true,
    added: result.added,
    regions: result.regions,
    alerted: result.alerted,
  });
}
