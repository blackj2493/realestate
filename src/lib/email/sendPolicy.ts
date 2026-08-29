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
 * Key under `user_email_lifecycle.sent` holding the ISO time of the last nightly digest.
 *
 * A single OVERWRITTEN value, not a dated key per send. A dated key would add 365 entries
 * per user per year to a JSONB column that is read on every send decision, to answer a
 * question that only ever concerns the newest one.
 */
export const DIGEST_MESSAGE_ID = "alerts_digest";

/** How long a user may be deferred before the weekly goes out despite a same-day digest. */
export const DEFERRAL_RELEASE_DAYS = 21;

/** Calendar day in the reader's timezone, not the server's — "same day" is a human claim. */
const torontoDay = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

/** Did the nightly digest reach this user today? Exported so the worker can count it. */
export function digestSentToday(
  sent: Record<string, string> | null | undefined,
  now: number
): boolean {
  const at = sent?.[DIGEST_MESSAGE_ID];
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && torontoDay(t) === torontoDay(now);
}

/**
 * When this user last received a Data Drop, from the newest `data_drop:` stamp — null if
 * they never have. Reads the VALUE rather than parsing the week out of the key, because the
 * value is already an exact ISO time and the key's week is only a coarse label.
 */
export function lastDataDropAt(
  sent: Record<string, string> | null | undefined
): number | null {
  if (!sent) return null;
  let newest: number | null = null;
  for (const [k, v] of Object.entries(sent)) {
    if (!k.startsWith("data_drop:")) continue;
    const t = Date.parse(v);
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  return newest;
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
 * CROSS-STREAM COLLISION IS NOW HANDLED HERE. On a Thursday the nightly digest lands at
 * 06:47 UTC and this at 11:40 UTC, and every ramp-week recipient has a saved market — so
 * most of them would receive two PureProperty emails inside five hours. Two in a morning is
 * the fastest way to teach someone to filter you. The digest wins any same-day collision
 * because the user configured it and it is time-sensitive; this one stands down.
 *
 * TWO ESCAPES, both load-bearing:
 *
 *   1. A user's FIRST Data Drop is never deferred. Every ramp-week-1 recipient has a saved
 *      market, so a blanket rule could have cut the first send from 107 to a fraction of it
 *      — silently, and only visible weeks later. One collision is a fair price for the send
 *      that decides whether this program exists.
 *   2. After DEFERRAL_RELEASE_DAYS since their last Data Drop, it goes out regardless.
 *      Without this, a user whose saved areas generate a digest most nights would be
 *      deferred every Thursday forever, and the most engaged people on the list would be
 *      the only ones who never see the weekly.
 *
 * The digest stamp is written by scripts/worker/alerts.ts under DIGEST_MESSAGE_ID. It
 * deliberately does NOT touch `last_sent_at` — that column drives the onboarding drip's
 * two-day gap, and stamping it nightly would silently end the drip for anyone with alerts.
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

  // Same-day collision with the nightly digest. Skipped entirely on a first send, and
  // released once the user is overdue — see the two escapes above.
  const lastDrop = lastDataDropAt(sent);
  if (lastDrop !== null && digestSentToday(sent, i.now)) {
    const overdue = i.now - lastDrop >= DEFERRAL_RELEASE_DAYS * DAY_MS;
    if (!overdue) return false;
  }

  return true;
}
