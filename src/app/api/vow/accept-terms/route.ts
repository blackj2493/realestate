/**
 * POST /api/vow/accept-terms
 *
 * Records the signed-in user's acceptance of the VOW Terms of Use (migration 029).
 * Called by the /welcome acceptance screen. 401 if not signed in.
 */

import { NextResponse } from "next/server";
import { recordTermsAcceptance } from "@/lib/auth/terms";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await recordTermsAcceptance();
  if (!result.ok) {
    const status = result.error === "unauthenticated" ? 401 : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
