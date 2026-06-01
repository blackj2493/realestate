/**
 * VOW consumer gate — the single server-side choke point for TRREB VOW access.
 *
 * VOW Listing Information (SOLD prices/dates, sold comps) and everything derived
 * from it (AVM, Value-Add, sold-price trends, region cap-rate stats) may only be
 * served to a registered Consumer with a bona-fide interest — a "secure password-
 * protected" VOW (PROPTX VOW Datafeed Agreement, Definitions + Purpose; §6.2(f)
 * permits derivative analytics only "on their VOW(s)"). Built on getCurrentUser().
 *
 *   - getConsumer():     SOFT gate. Returns { user, isConsumer }. Callers that want a
 *                        HouseSigma-style teaser return a `locked` payload (count/shape
 *                        only — NO real VOW values) when isConsumer is false, so the
 *                        sensitive numbers never reach an anonymous client.
 *   - requireConsumer(): HARD gate. Returns a 401 response for anonymous callers, for
 *                        endpoints where anonymous users should receive nothing at all.
 *
 * Phase 4 will extend both to also require Terms-of-Use acceptance
 * (profiles.terms_accepted_at) before granting access.
 */

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/supabase/server";

export interface ConsumerStatus {
  user: User | null;
  /** True once a registered user is present (Phase 4: + accepted Terms). */
  isConsumer: boolean;
}

/** SOFT gate — who is asking. `isConsumer === false` ⇒ return a `locked` teaser shape. */
export async function getConsumer(): Promise<ConsumerStatus> {
  const user = await getCurrentUser();
  return { user, isConsumer: !!user };
}

export type ConsumerGate =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

/** HARD gate — 401 for anonymous. Use where anonymous users should get nothing. */
export async function requireConsumer(): Promise<ConsumerGate> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sign in required to view VOW data", code: "VOW_AUTH_REQUIRED" },
        { status: 401 }
      ),
    };
  }
  return { ok: true, user };
}
