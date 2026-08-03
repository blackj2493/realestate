/**
 * Server-side activation-event logging (engagement build plan 0.3).
 *
 * PostHog (src/lib/analytics/posthog.ts) is client-side only — it can be blocked,
 * dropped, or simply not wired for these actions, and a server worker can't read it.
 * The onboarding drip (WS1) and the cohort-retention funnels (WS6) need a *verifiable*
 * record of what a user actually did. This writes one append-only row per milestone to
 * `activation_events` (migration 104) at the server-side write point of each action.
 *
 * CONTRACT: logging is best-effort and MUST NEVER break or meaningfully slow the user's
 * action. Every call is internally try/caught and resolves to void — it never throws.
 * It always uses the service-role client because `activation_events` is RLS
 * service-role-only, regardless of which client the calling route uses for its own work.
 * Callers `await` it (a single fast insert) so the row lands before the serverless
 * function can freeze; a failure (e.g. table not yet migrated) is logged, not surfaced.
 */

import { getServiceRoleClient } from "@/lib/supabase/client";

export type ActivationKind =
  | "watch_address" // tracked an address on /address (anonymous, email-keyed)
  | "save_area" // saved a market area / bubble (city, community, or drawn)
  | "save_listing" // added a listing to the watchlist
  | "enable_alert" // turned on an alert (listing bell, or an existing area's bell)
  | "set_persona" // chose/changed a dashboard persona (reserved; not yet emitted)
  | "set_prefs" // changed dashboard prefs (reserved; not yet emitted)
  | "accept_vow_terms" // first-ever VOW Terms acceptance at /welcome (the unlock)
  | "apply"; // submitted the /apply lead-capture form (pre-account)

export interface ActivationInput {
  kind: ActivationKind;
  /** Present for signed-in actions. */
  userId?: string | null;
  /** Present for anonymous / email-keyed actions (stored lowercased). */
  email?: string | null;
  /** Small, non-sensitive context about the action (city, listing_key, area_type…). */
  context?: Record<string, unknown> | null;
}

export async function recordActivation(input: ActivationInput): Promise<void> {
  try {
    const supabase = getServiceRoleClient();
    const { error } = await supabase.from("activation_events").insert({
      kind: input.kind,
      user_id: input.userId ?? null,
      email: input.email ? input.email.trim().toLowerCase() : null,
      context: input.context ?? null,
    });
    if (error) {
      // Table absent (pre-migration deploy) or transient — never fail the caller.
      console.warn(`[activation] ${input.kind} insert skipped:`, error.message);
    }
  } catch (e) {
    console.warn(`[activation] ${input.kind} insert threw:`, e);
  }
}
