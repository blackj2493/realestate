/**
 * Onboarding send policy — the per-message gate the sequence engine (WS1.2) applies
 * before sending any drip email. Pulled out as a pure, testable module so the worker
 * stays thin and the frequency-cap / preference logic (WS4.2) can be unit-tested.
 *
 * A message is allowed only when ALL hold:
 *   • the user is not master-unsubscribed (profiles.marketing_opt_out),
 *   • the onboarding stream is on (email_prefs.onboarding !== false; missing row = on),
 *   • no active pause covers now (email_prefs.pause_until),
 *   • this exact message hasn't already been sent (user_email_lifecycle.sent[id]),
 *   • the global frequency cap is satisfied (last_sent_at older than the cadence gap).
 *
 * Cross-stream collision (urgent alert vs drip) is a Phase-1 refinement; today the cap is
 * enforced within the onboarding stream via last_sent_at.
 */

export interface EmailPrefsRow {
  onboarding?: boolean;
  cadence?: "standard" | "reduced" | "minimal";
  pause_until?: string | null;
}

export interface LifecycleRow {
  sent?: Record<string, string> | null;
  last_sent_at?: string | null;
}

/** Default minimum days between onboarding sends (standard cadence). */
export const ONBOARDING_MIN_GAP_DAYS = 2;

const DAY_MS = 86_400_000;

/** Days that must elapse between onboarding sends for a given cadence. */
export function gapDaysForCadence(cadence?: string): number {
  if (cadence === "reduced") return 7;
  if (cadence === "minimal") return Infinity; // essential/triggered only → no drip
  return ONBOARDING_MIN_GAP_DAYS;
}

export interface CanSendInput {
  messageId: string;
  /** epoch ms — passed in so this stays pure/testable. */
  now: number;
  marketingOptOut?: boolean;
  prefs?: EmailPrefsRow | null;
  lifecycle?: LifecycleRow | null;
}

export function canSendOnboarding(i: CanSendInput): boolean {
  if (i.marketingOptOut) return false;

  const prefs = i.prefs ?? null;
  if (prefs?.onboarding === false) return false;
  if (prefs?.pause_until && Date.parse(prefs.pause_until) > i.now) return false;

  const gap = gapDaysForCadence(prefs?.cadence);
  if (!Number.isFinite(gap)) return false; // 'minimal' suppresses the drip entirely

  const lc = i.lifecycle ?? null;
  if (lc?.sent && lc.sent[i.messageId]) return false; // already sent this message

  if (lc?.last_sent_at) {
    const since = i.now - Date.parse(lc.last_sent_at);
    if (Number.isFinite(since) && since < gap * DAY_MS) return false; // frequency cap
  }

  return true;
}
