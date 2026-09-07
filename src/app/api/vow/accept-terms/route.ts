/**
 * POST /api/vow/accept-terms
 *
 * Records the signed-in user's acceptance of the VOW Terms of Use (migration 029).
 * Called by the /welcome acceptance screen. 401 if not signed in, 400 if the three
 * VOW attestations aren't all affirmed in the request body.
 *
 * It also stores the starting market the form asked for (`region`) and subscribes the
 * account to that area's nightly email. Signup is the one moment we are guaranteed to get
 * an answer — /welcome redirects past this form forever once Terms are on file — and the
 * market previously stopped at localStorage, so an account that never opened /dashboard
 * was never reachable by email at all. See seedSignupRegion for the full chain.
 *
 * The region is REQUIRED by the form but only VALIDATED here, never required:
 *   • absent  → a bundle from before this shipped. Let it through and log; failing Terms
 *               acceptance for every tab open across a deploy is far worse than one
 *               account without a seeded market.
 *   • present but unusable (blank, >80 chars, not a string) → 400, because a client that
 *               sends the field is this build, and a bad value is a bug worth surfacing.
 * Same absent-vs-present-but-wrong split PUT /api/dashboard-config applies to
 * `baseUpdatedAt`, for the same deploy-day reason.
 */

import { NextResponse } from "next/server";
import { recordTermsAcceptance } from "@/lib/auth/terms";
import { sendWelcomeEmail } from "@/lib/alerts/welcomeEmail";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cleanSignupRegion, seedSignupRegion } from "@/lib/dashboard/seedSignupRegion";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Don't trust the client UI to have shown the gate: require the three VOW
  // attestations in the body and verify them server-side before recording.
  let body: {
    notAgent?: unknown;
    bonaFide?: unknown;
    agree?: unknown;
    region?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    // malformed/empty body → treated as missing attestations below
  }
  if (body?.notAgent !== true || body?.bonaFide !== true || body?.agree !== true) {
    return NextResponse.json({ ok: false, error: "attestations_required" }, { status: 400 });
  }

  // Presence, not truthiness — see the header. `"region" in body` is this build talking.
  const sentRegion = !!body && typeof body === "object" && "region" in body;
  const region = cleanSignupRegion(body.region);
  if (sentRegion && region === null) {
    return NextResponse.json({ ok: false, error: "region_invalid" }, { status: 400 });
  }

  const result = await recordTermsAcceptance();
  if (!result.ok) {
    const status = result.error === "unauthenticated" ? 401 : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  // Seed the market AFTER acceptance, and never let it fail the response: the user's
  // actual action was accepting the Terms, and this is bookkeeping behind it.
  let seeded = false;
  if (region && result.userId) {
    try {
      const supabase = await createSupabaseServerClient();
      const seed = await seedSignupRegion(supabase, result.userId, region);
      seeded = seed.seeded;
      if (seed.error) console.error("[accept-terms] region seed failed:", seed.error);
    } catch (e) {
      console.error("[accept-terms] region seed threw (acceptance recorded):", e);
    }
  } else if (!sentRegion) {
    console.warn("[accept-terms] no region in body — pre-deploy client bundle?");
  }

  // First-ever acceptance = a newly activated consumer → welcome email. Best-effort:
  // a mail failure must never fail the Terms acceptance the user just made.
  if (result.firstAcceptance && result.email) {
    try {
      await sendWelcomeEmail(result.email);
    } catch (e) {
      console.error("[accept-terms] welcome email failed (acceptance recorded):", e);
    }
  }

  return NextResponse.json({ ok: true, region: region ?? null, seeded });
}
