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
 */

export interface DailyCounts {
  /** Distinct anonymous viewer ids seen in listing_views. */
  visitors: number;
  /** New real accounts (QA excluded). */
  signups: number;
  /** Distinct users with a session that day, excluding that day's signups. */
  returning: number;
  /** profiles.marketing_opt_out_at fell on this day. */
  unsubscribes: number;
  /** Rows added to watchlist + market_bubbles — the assets that make a user emailable. */
  assetsCreated: number;
  /** New rows in terminal_applications. */
  applications: number;
  /** Rows in vow_access_log — gated-data engagement. */
  vowReads: number;
}

export interface EmailHealth {
  digestSent: number;
  digestFailed: number;
  digestSuppressed: number;
  /** Rows written to email_send_failures on the day. */
  sendFailures: number;
}

export interface LeadRow {
  createdAt: string;
  kind: string;
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
  leads: LeadRow[];
  /** Whole-base context, not a daily figure. */
  totals: {
    users: number;
    optedOut: number;
    /** Users with at least one watchlist row or market bubble. The rest receive NO email
     *  after the onboarding drip expires (~day 30), which is the structural retention hole. */
    withAnyAsset: number;
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
 */
export function attention(m: DailyMetricsInput): Attention[] {
  const out: Attention[] = [];

  if (m.leads.length > 0) {
    out.push({
      severity: "alert",
      text: `${m.leads.length} new application${m.leads.length === 1 ? "" : "s"} to work — listed below.`,
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
  if (m.email.digestSent === 0 && m.today.assetsCreated + m.totals.withAnyAsset > 0) {
    out.push({
      severity: "watch",
      text: "The nightly digest sent 0 emails. Expected on a genuinely quiet night — suspicious two nights running.",
    });
  }

  if (m.today.signups === 0 && m.today.visitors >= 20) {
    out.push({
      severity: "watch",
      text: `${m.today.visitors} visitors and 0 signups. Worth checking the signup path still works.`,
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

/** One-line summary for the subject line: the two numbers worth seeing on a phone. */
export function subjectLine(m: DailyMetricsInput): string {
  const bits = [`${m.today.signups} signup${m.today.signups === 1 ? "" : "s"}`, `${m.today.visitors} visitors`];
  if (m.leads.length) bits.unshift(`${m.leads.length} lead${m.leads.length === 1 ? "" : "s"}`);
  if (m.today.unsubscribes) bits.push(`${m.today.unsubscribes} unsub`);
  return `${m.day} · ${bits.join(" · ")}`;
}
