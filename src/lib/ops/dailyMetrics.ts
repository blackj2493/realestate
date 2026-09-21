/**
 * Daily operator metrics — the shape of the morning report, and the rules that decide
 * what in it deserves attention.
 *
 * SPLIT ON PURPOSE: this module is pure. The SQL lives in scripts/worker/dailyMetrics.ts
 * (it needs the `auth` schema, so it goes over direct pg, not PostgREST). Everything that
 * turns numbers into a judgement lives here, where it can be tested without a database.
 *
 * ── Two measurement rules that are not optional ────────────────────────────────
 *
 * 1. EXCLUDE QA ACCOUNTS. Production `auth.users` holds ~98 accounts on
 *    `@pureproperty-qa.test`, created in one week in June 2026. They never return. Left in,
 *    they are ~21% of the denominator and they move retention and opt-out in the flattering
 *    direction. Every query that counts users filters them out.
 *
 * 2. A DAY IS AMERICA/TORONTO, NOT UTC. The report is read over breakfast in Toronto; a UTC
 *    day would cut "yesterday" at 8pm and put the evening's signups in the wrong bucket.
 *
 * ── What a small-numbers report must not do ────────────────────────────────────
 * Signups run 2-12/day. At that size a single day says almost nothing, and a report that
 * shouts about every wiggle trains you to ignore it. So every headline number carries the
 * trailing 7-day average beside it, deltas are only called out past MIN_SIGNAL, and the
 * attention block stays empty on an ordinary day.
 *
 * ── A NAME MUST MATCH ITS QUERY (audit 2026-09-20) ─────────────────────────────
 * The first build of this report was arithmetically correct and still misled, because
 * three labels described something the SQL did not measure. Every rename below exists to
 * close that gap, and each field's comment states the limit of what it can see. If you add
 * a field, name it after the query you wrote, not after the thing you wish you could see.
 */

export interface DailyCounts {
  /** Distinct browser ids that opened a listing page they had NOT opened before.
   *
   *  NOT site visitors, and the difference is large. `listing_views` is written only by
   *  SocialProofBar, which mounts on a listing DETAIL page, so the homepage, search, the
   *  map, /analytics and /data contribute nothing. The write upserts on
   *  (listing_key, viewer_id), so a return to the same listing never creates a second row
   *  — over 2026-09-12..19, 1,929 of 1,971 ids appeared on exactly one day. `viewer_id` is
   *  a localStorage UUID, so it counts browsers, and a cleared browser is a new one. The
   *  row carries no referrer and no user agent, so a crawler that runs JS is
   *  indistinguishable from a person. */
  listingViewers: number;
  /** New real accounts (QA excluded). */
  signups: number;
  /** Pre-existing accounts that left ANY signed-in trace that day: a gated read, a save,
   *  an activation event, or a login. A floor, not a true count — a signed-in user who
   *  browses without touching gated data leaves no server-side trace at all. */
  returning: number;
  /** The subset of `returning` that re-authenticated. Supabase writes `auth.sessions` only
   *  at login, never on a token refresh, so this alone under-reports by ~10x (2 against 23
   *  on 2026-09-19). It was the whole of "Returning" until 2026-09-20; it survives only to
   *  show that gap. */
  returningLogins: number;
  /** profiles.marketing_opt_out_at fell on this day. */
  unsubscribes: number;
  /** Saves the user CHOSE to make: watchlist rows, plus market bubbles that the signup
   *  flow did not create. Signup requires an area, so every new account is handed a bubble
   *  within seconds; counting those made this a second signup counter (22 reported against
   *  ~5 real on 2026-09-19).
   *
   *  Still a SNAPSHOT, not a log: an unsave deletes the row, so a past day's figure shrinks
   *  after the fact. Never treat the trailing average as a fixed historical series. */
  assetsSaved: number;
  /** Bubbles the signup flow created for a brand-new account. Reported beside
   *  `assetsSaved`, never added to it — it tracks signups, not engagement. */
  assetsAtSignup: number;
  /** /apply submissions from that day whose email STILL has no account. The genuine
   *  abandoned signup, and the only part of that table worth acting on. */
  abandonedSignups: number;
  /** Rows in vow_access_log — gated-data engagement. */
  vowReads: number;
  /** Distinct users behind `vowReads`. 205 reads by 35 people is a different day from
   *  205 reads by 205 people, and the read count alone cannot tell them apart. */
  vowReaders: number;
}

export interface EmailHealth {
  digestSent: number;
  digestFailed: number;
  digestSuppressed: number;
  /** Rows written to email_send_failures on the day. */
  sendFailures: number;
}

/** One named human, for a list the operator reads by eye. */
export interface PersonRow {
  createdAt: string;
  /** "Name · email", or the email alone when no name was captured. */
  who: string;
  detail?: string;
}

export interface DailyMetricsInput {
  /** The Toronto day being reported, "YYYY-MM-DD". */
  day: string;
  today: DailyCounts;
  /** Same shape, averaged over the 7 days before `day`. */
  prior7: DailyCounts;
  activation: Array<{ kind: string; count: number }>;
  email: EmailHealth;
  /** Everyone who created an account on the day. They finished; they are not work. */
  signups: PersonRow[];
  /** Everyone who started /apply on the day and still has no account. These are work. */
  abandoned: PersonRow[];
  /** Whole-base context, not a daily figure. */
  totals: {
    users: number;
    optedOut: number;
    /** Users with at least one watchlist row or market bubble. The rest receive NO email
     *  after the onboarding drip expires (~day 30), which is the structural retention hole.
     *  A signup-created bubble counts here ON PURPOSE: it does make the user emailable, so
     *  for this question it is not noise. */
    withAnyAsset: number;
    /** Every unconverted /apply email, not only the day's. */
    abandonedAllTime: number;
  };
}

/** Below this, a percentage swing on a 2-12/day metric is noise, not news. */
const MIN_SIGNAL = 3;

export const pct = (n: number, d: number): number => (d > 0 ? (n / d) * 100 : 0);
export const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface Delta {
  /** "up" | "down" | "flat" — flat when the move is too small to mean anything. */
  direction: "up" | "down" | "flat";
  /** Percent change vs the trailing average, rounded. 0 when the baseline is 0. */
  changePct: number;
  /** Rendered "▲ 42%" / "▼ 18%" / "—". */
  label: string;
}

/**
 * Compare a day against its trailing average. Deliberately conservative: a move is "flat"
 * unless BOTH the absolute change clears MIN_SIGNAL and the relative change clears 15%.
 * One extra signup on a base of two is a 50% jump and means nothing.
 */
export function delta(value: number, baseline: number): Delta {
  const absChange = value - baseline;
  const changePct = baseline > 0 ? Math.round((absChange / baseline) * 100) : 0;
  if (Math.abs(absChange) < MIN_SIGNAL || Math.abs(changePct) < 15 || baseline <= 0) {
    return { direction: "flat", changePct, label: "—" };
  }
  return {
    direction: absChange > 0 ? "up" : "down",
    changePct,
    label: `${absChange > 0 ? "▲" : "▼"} ${Math.abs(changePct)}%`,
  };
}

export interface Attention {
  severity: "alert" | "watch";
  text: string;
}

/**
 * What needs a human today. Empty on an ordinary day — that is the contract. A daily email
 * that always has a red box is a daily email that gets filtered.
 *
 * Ordered by how expensive it is to ignore: money and consent first, then delivery, then
 * growth.
 *
 * WHY THE FIRST RULE CHANGED (2026-09-20): completed applications used to head this list
 * as "N new applications to work". They were never work. /apply writes its row seconds
 * BEFORE the account (2-12s on 2026-09-19), so every name in that alert had already
 * finished signing up, and the alert fired on every day with traffic. The rule now fires on
 * the opposite case, which is rare (9 in the first four months) and genuinely actionable.
 */
export function attention(m: DailyMetricsInput): Attention[] {
  const out: Attention[] = [];

  // Someone filled the form, gave you their email, and never got an account. The only lead
  // in this report you can still win back.
  if (m.abandoned.length > 0) {
    const n = m.abandoned.length;
    out.push({
      severity: "alert",
      text: `${n} ${n === 1 ? "person" : "people"} started signup and still ${n === 1 ? "has" : "have"} no account — listed below. Reach out, or check the signup path.`,
    });
  }

  // Consent: an unsubscribe spike is the one metric where the right response is to send
  // LESS, and it is invisible in a sent-count.
  if (m.today.unsubscribes >= 3 && m.today.unsubscribes > m.prior7.unsubscribes * 2) {
    out.push({
      severity: "alert",
      text: `${m.today.unsubscribes} unsubscribes, against a ${round1(m.prior7.unsubscribes)}/day average. Check what went out.`,
    });
  }

  // Delivery: this is the failure that used to be silent.
  if (m.email.digestFailed > 0 || m.email.sendFailures > 0) {
    const n = Math.max(m.email.digestFailed, m.email.sendFailures);
    out.push({
      severity: "alert",
      text: `${n} email${n === 1 ? "" : "s"} were REJECTED by the provider. Those people got nothing; they retry on the next run.`,
    });
  }

  // A digest that sends to nobody on a day with activity is the selector breaking, which
  // looks identical to a quiet night unless something says so.
  if (m.email.digestSent === 0 && m.today.assetsSaved + m.totals.withAnyAsset > 0) {
    out.push({
      severity: "watch",
      text: "The nightly digest sent 0 emails. Expected on a genuinely quiet night — suspicious two nights running.",
    });
  }

  if (m.today.signups === 0 && m.today.listingViewers >= 20) {
    out.push({
      severity: "watch",
      text: `${m.today.listingViewers} listing viewers and 0 signups. Worth checking the signup path still works.`,
    });
  }

  const assetless = m.totals.users - m.totals.withAnyAsset;
  if (m.totals.users > 0 && assetless / m.totals.users > 0.6) {
    out.push({
      severity: "watch",
      text: `${assetless} of ${m.totals.users} users have saved nothing, so they get no email once onboarding ends.`,
    });
  }

  return out;
}

/** One-line summary for the subject line: the numbers worth seeing on a phone. */
export function subjectLine(m: DailyMetricsInput): string {
  const bits = [
    `${m.today.signups} signup${m.today.signups === 1 ? "" : "s"}`,
    `${m.today.listingViewers} viewers`,
  ];
  if (m.abandoned.length) bits.unshift(`${m.abandoned.length} unfinished`);
  if (m.today.unsubscribes) bits.push(`${m.today.unsubscribes} unsub`);
  return `${m.day} · ${bits.join(" · ")}`;
}
