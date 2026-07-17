/**
 * POST /api/vow/accept-terms
 *
 * Records the signed-in user's acceptance of the VOW Terms of Use (migration 029).
 * Called by the /welcome acceptance screen. 401 if not signed in, 400 if the three
 * VOW attestations aren't all affirmed in the request body.
 */

import { NextResponse } from "next/server";
import { recordTermsAcceptance } from "@/lib/auth/terms";
import { sendWelcomeEmail } from "@/lib/alerts/welcomeEmail";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Don't trust the client UI to have shown the gate: require the three VOW
  // attestations in the body and verify them server-side before recording.
  let body: { notAgent?: unknown; bonaFide?: unknown; agree?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // malformed/empty body → treated as missing attestations below
  }
  if (body?.notAgent !== true || body?.bonaFide !== true || body?.agree !== true) {
    return NextResponse.json({ ok: false, error: "attestations_required" }, { status: 400 });
  }

  const result = await recordTermsAcceptance();
  if (!result.ok) {
    const status = result.error === "unauthenticated" ? 401 : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
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

  return NextResponse.json({ ok: true });
}
