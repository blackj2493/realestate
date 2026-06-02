/**
 * VOW Terms-of-Use enforcement.
 *
 * The VOW agreement requires a Consumer to accept Terms of Use (and attest a bona-fide
 * interest) before accessing VOW data. These helpers record and check that acceptance
 * against `profiles` (columns added in migration 029), and feed the consumer gate
 * (requireConsumer/getConsumer) and the dashboard server gate.
 *
 * ROLLOUT SAFETY: enforcement is OFF by default (VOW_ENFORCE_TERMS !== "true"). When
 * off, hasAcceptedTerms() short-circuits to true with NO DB round-trip, so this adds
 * zero cost and zero behavior change until deliberately enabled. Enable it only AFTER
 * migration 029 is applied — otherwise every signed-in user would be sent to accept
 * terms against columns that don't exist yet.
 */

import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

/** Bump when the Terms text materially changes — forces everyone to re-accept. */
export const CURRENT_TERMS_VERSION = "2026-06-01";

/** Server-side enforcement switch. Flip VOW_ENFORCE_TERMS=true once migration 029 is live. */
export const TERMS_ENFORCED = process.env.VOW_ENFORCE_TERMS === "true";

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
export async function recordTermsAcceptance(): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const sb = await createSupabaseServerClient();
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
  return { ok: true };
}
