/**
 * Email send policy — the per-user gates the send workers apply before any email goes out.
 * Pure and testable, so the workers stay thin and the preference logic (WS4.2) can be
 * unit-tested without Supabase.
 *
 * One gate per stream that actually sends today:
 *   • canSendOnboarding — the milestone drip   (scripts/worker/onboarding.ts)
 *   • canSendAlerts     — the nightly digest   (scripts/worker/alerts.ts)
 *   • canSendDataDrop   — the weekly market email (scripts/worker/dataDrop.ts)
 *
 * All three read the same `email_prefs` row and all treat a MISSING row as "all streams on"
 * (migration 106's opt-out model, so existing users need no backfill). They differ in what
 * each preference MEANS for that stream — which is dictated by the words the user actually
 * read on /account/emails, not by the column name. Compare canSendAlerts, where cadence
 * deliberately does NOT gate, with canSendDataDrop, where it does — the two settings promise
 * different things about a digest the user configured versus a weekly we send unprompted.
 *
 * Cross-stream collision (urgent alert vs drip) is a Phase-1 refinement; today the drip's
 * cap is enforced within its own stream via last_sent_at.
 */

export interface EmailPrefsRow {
  onboarding?: boolean;
  /** "Saved home & area alerts" — the nightly digest stream. */
  alerts?: boolean;
  /** "Weekly market update" — the Data Drop (WS2). */
  data_drop?: boolean;
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

export interface CanSendAlertsInput {
  /** epoch ms — passed in so this stays pure/testable. */
  now: number;
  /** profiles.marketing_opt_out — the RFC 8058 one-click master switch. */
  marketingOptOut?: boolean;
  /** The user's email_prefs row, or null when they have never opened the preference centre. */
  prefs?: EmailPrefsRow | null;
}

/**
 * May the nightly digest email this user tonight?
 *
 * Until this existed the digest read ONLY marketing_opt_out, so a user who switched off
 * "Saved home & area alerts" or pressed "Pause all emails for 30 days" kept receiving it.
 * That is a consent defect, not a cosmetic one — the page made a promise the sender did
 * not keep.
 *
 * The three gates, and why cadence is NOT one of them:
 *   • marketingOptOut  — master switch, reads "Turn everything off in one place."
 *   • alerts === false — the stream toggle the user flipped for exactly this email.
 *   • pause_until      — the button reads "Pause ALL emails for 30 days", so it covers the
 *                        digest too; only account/security mail is exempt, and none of that
 *                        is governed by this table.
 *   • cadence          — deliberately ignored. Both non-standard settings PROMISE the
 *                        digest survives: "Fewer emails — at most one non-urgent email a
 *                        week" (a digest the user configured is not that), and "Only the
 *                        essentials — just alerts you set and account messages" (which
 *                        names the digest as a keeper). Suppressing it under 'minimal'
 *                        would break the same promise from the other direction.
 *
 * Fail-OPEN on unparseable input: an unreadable pause date must not silently mute an alert
 * the user asked for. Same posture as canSendOnboarding.
 *
 * A false here means "do not SEND"; it does NOT mean "do not advance baselines". The caller
 * must still advance its watermarks, or a user who re-subscribes gets a backlog dump of
 * every change they missed.
 */
export function canSendAlerts(i: CanSendAlertsInput): boolean {
  if (i.marketingOptOut) return false;

  const prefs = i.prefs ?? null; // missing row = all streams on (migration 106)
  if (prefs?.alerts === false) return false;
  if (prefs?.pause_until && Date.parse(prefs.pause_until) > i.now) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly Data Drop (WS2)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanSendDataDropInput {
  /** Stable per-week key PREFIX, e.g. "data_drop:2026-W36". See the note below. */
  weekKeyPrefix: string;
  /** epoch ms — passed in so this stays pure/testable. */
  now: number;
  /** profiles.marketing_opt_out — the RFC 8058 one-click master switch. */
  marketingOptOut?: boolean;
  prefs?: EmailPrefsRow | null;
  lifecycle?: LifecycleRow | null;
}

/**
 * May we send this user this week's Data Drop?
 *
 * Allowed only when ALL hold: not master-unsubscribed; the `data_drop` stream is on
 * (missing row = on); no active pause; cadence is not 'minimal'; and this ISO week has not
 * already been sent.
 *
 * CADENCE GATES HERE, AND DELIBERATELY DOES NOT IN canSendAlerts. The difference is what
 * each label promised. "Fewer emails — at most one non-urgent email a week" describes this
 * email exactly, so 'reduced' KEEPS it: excluding it would silently redefine the setting as
 * "no weekly digest at all", and `data_drop` already has its own switch for anyone who wants
 * that. "Only the essentials — just alerts you set and account messages" does not describe a
 * weekly we send unprompted, so 'minimal' drops it — while the nightly digest, which the
 * user configured, survives both settings. Same table, opposite answers, both from the
 * words on the page.
 *
 * (Cross-stream collision — a 'reduced' user receiving BOTH the nightly digest and this in
 * one week — remains the Phase-1 refinement this module already defers.)
 *
 * WHY A PREFIX, NOT AN EXACT KEY. The stamped id carries the chosen headline kind
 * ("data_drop:2026-W36:leverage") so a rotation guard can read last week's lead with no
 * schema change. But the kind is derived from board data that moves between a failed send
 * and its retry, so an exact-key check could let the same week go out twice under a
 * different suffix. Match the week, ignore the suffix.
 */
export function canSendDataDrop(i: CanSendDataDropInput): boolean {
  if (i.marketingOptOut) return false;

  const prefs = i.prefs ?? null; // missing row = all streams on (migration 106)
  if (prefs?.data_drop === false) return false;
  if (prefs?.pause_until && Date.parse(prefs.pause_until) > i.now) return false;
  if (prefs?.cadence === "minimal") return false;

  const sent = i.lifecycle?.sent ?? null;
  if (sent && Object.keys(sent).some((k) => k.startsWith(i.weekKeyPrefix))) return false;

  return true;
}
