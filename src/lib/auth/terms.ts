/**
 * VOW Terms-of-Use enforcement.
 *
 * The VOW agreement requires a Consumer to accept Terms of Use (and attest a bona-fide
 * interest) before accessing VOW data. These helpers record and check that acceptance
 * against `profiles` (columns added in migration 029), and feed the consumer gate
 * (requireConsumer/getConsumer) and the dashboard server gate.
 *
 * ROLLOUT SAFETY: enforcement is ON by default (fail-closed). A missing or unset
 * VOW_ENFORCE_TERMS must never silently open the VOW gate — set VOW_ENFORCE_TERMS=false
 * only to explicitly disable during maintenance or a rollback. Migration 029 must be
 * applied before this gate can perform DB reads; if the migration is absent, query
 * errors fail OPEN with a loud log (see hasAcceptedTerms), so there is no lockout risk.
 */

import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { recordActivation } from "@/lib/analytics/activation";

/** Bump when the Terms text materially changes — forces everyone to re-accept. */
export const CURRENT_TERMS_VERSION = "2026-06-01";

/** Server-side enforcement switch. ENFORCED unless explicitly disabled with
 *  VOW_ENFORCE_TERMS=false — a missing env var must never silently open the
 *  VOW gate (audit HIGH-3). Query errors still fail open with a loud log, so
 *  a missing migration 029 degrades to logging, not lockout. */
export const TERMS_ENFORCED = process.env.VOW_ENFORCE_TERMS !== "false";

/**
 * Has THIS user accepted the CURRENT Terms version? Always true when enforcement is
 * off (no DB call). Fails OPEN on a query error (e.g. migration 029 not yet applied)
 * so a misconfiguration can never brick VOW access — it logs loudly instead.
 */
export async function hasAcceptedTerms(userId: string): Promise<boolean> {
  if (!TERMS_ENFORCED) return true;
  try {
    const sb = await createSupabaseServerClient();
    const { data, error } = await sb
      .from("profiles")
      .select("terms_accepted_at, terms_version")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("[terms] hasAcceptedTerms query failed (failing open):", error.message);
      return true;
    }
    return !!data?.terms_accepted_at && data.terms_version === CURRENT_TERMS_VERSION;
  } catch (e) {
    console.error("[terms] hasAcceptedTerms threw (failing open):", e);
    return true;
  }
}

/**
 * Record the current user's acceptance of the current Terms version. Writes via the
 * user-bound server client so the owner-only RLS policy authorizes the update.
 */
export async function recordTermsAcceptance(): Promise<{
  ok: boolean;
  error?: string;
  /** True only on a user's first-ever acceptance (a re-accept after a Terms version
   *  bump already has a non-null timestamp) — lets callers fire a welcome once. */
  firstAcceptance?: boolean;
  email?: string;
  /** The account that accepted. Handed back so a caller doing follow-up work in the same
   *  request (the signup region seed) does not pay for a second getCurrentUser() round
   *  trip on the critical path — this function has already resolved the session. */
  userId?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const sb = await createSupabaseServerClient();
  // Read prior state before writing so we can tell a brand-new consumer (never accepted)
  // apart from a re-acceptance. Best-effort: a read miss just suppresses the welcome.
  const { data: prior } = await sb
    .from("profiles")
    .select("terms_accepted_at")
    .eq("id", user.id)
    .maybeSingle();
  const firstAcceptance = !prior?.terms_accepted_at;

  const now = new Date().toISOString();
  const { error } = await sb
    .from("profiles")
    .update({
      terms_accepted_at: now,
      terms_version: CURRENT_TERMS_VERSION,
      bona_fide_attested: true,
      updated_at: now,
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  // Activation milestone (0.3) — the VOW unlock is the single most important
  // activation event; log only the first-ever acceptance, not re-accepts.
  if (firstAcceptance) {
    await recordActivation({
      kind: "accept_vow_terms",
      userId: user.id,
      email: user.email ?? null,
    });
  }

  return { ok: true, firstAcceptance, email: user.email ?? undefined, userId: user.id };
}
