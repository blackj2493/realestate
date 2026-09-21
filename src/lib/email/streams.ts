/**
 * The catalogue of email streams — one entry per `email_prefs` column (migration 106),
 * and the single source of truth for which of them the preference centre may show.
 *
 * WHY this exists: migration 106 created five stream columns up front for a Phase 1 that
 * has not shipped. `/account/emails` listed all five, so `data_drop`, `home_value` and
 * `product` rendered as working switches with nothing behind them — on delivered no mail,
 * off changed no behaviour. A preference centre that quietly lies costs more trust than a
 * short one earns.
 *
 * Splitting the catalogue out of the component gives the invariant a place to live and a
 * test to enforce it (streams.test.ts): a stream is offered to users if and ONLY if
 * `sender` names the code that sends it AND `armedBy` names the thing that runs it.
 *
 * BOTH HALVES, because the first one alone was not enough. `home_value` named a real,
 * tested sender and appeared on /account/emails for weeks while nothing ever called it —
 * 0 of 538 addresses received one. A switch in front of a sender nobody runs is the same
 * lie as a switch in front of no sender.
 *
 * To launch a stream: ship the sender, ARM it, then fill in both fields here. The UI picks
 * it up with no further change.
 *
 * The COLUMNS are deliberately left in place. Hiding a switch must not drop a preference a
 * user already expressed, and /api/email-prefs still reads and writes all five.
 */

export type StreamKey = "alerts" | "onboarding" | "data_drop" | "home_value" | "product";

export interface EmailStream {
  key: StreamKey;
  /** Plain-language label shown on /account/emails (voice.md §5.1 — no jargon here). */
  title: string;
  desc: string;
  /**
   * The worker/module that actually sends this stream, or null when nothing does yet.
   * A null sender means the stream is HIDDEN from the preference centre.
   */
  sender: string | null;
  /**
   * What CAUSES that sender to run, or null when nothing does.
   *
   * SHIPPED AND ARMED ARE DIFFERENT THINGS, and this field exists because the original
   * invariant conflated them. `streetRecap.ts` has been in the repo, tested, and named as
   * `home_value`'s sender since it merged — while `street-recap.yml` carries only
   * `workflow_dispatch` and no pg_cron row, so nothing has ever called it. Measured
   * 2026-09-21: 0 of 538 addresses have ever received one, while the toggle "Your street,
   * monthly" sat on /account/emails the whole time. That is precisely the quiet lie the
   * `sender` field was added to prevent, told one level further down.
   *
   * A workflow path is resolved on disk by the test. A pg_cron job is named as
   * `pg_cron: <jobname>`: migrations 127/128 moved most scheduled work there, and a
   * pg_cron-armed workflow fires as `workflow_dispatch`, so it is indistinguishable from an
   * unarmed one in the YAML. That is why this is a declaration rather than something
   * inferred — the only honest way to record it is to write it down when you arm it.
   */
  armedBy: string | null;
}

export const EMAIL_STREAMS: EmailStream[] = [
  {
    key: "alerts",
    title: "Saved home & area alerts",
    desc: "New listings, price drops, and sales for the homes and areas you follow.",
    sender: "scripts/worker/alerts.ts",
    armedBy: ".github/workflows/nightly-emails.yml",
  },
  {
    key: "onboarding",
    title: "Getting-started tips",
    desc: "A few short guides to help you set up and get the most out of PureProperty.",
    sender: "scripts/worker/onboarding.ts",
    armedBy: ".github/workflows/nightly-emails.yml",
  },
  {
    key: "data_drop",
    title: "Weekly market update",
    desc: "One email a week on what's moving in the markets you follow.",
    sender: "scripts/worker/dataDrop.ts",
    armedBy: ".github/workflows/weekly-data-drop.yml",
  },
  {
    // The COLUMN is still `home_value` (migration 106 named it for a value email), but the
    // stream that finally sends on it deliberately carries no valuation: `property_estimates`
    // covers active listings only, and ~21% of homes in our markets have any vault record at
    // all. The label describes what ARRIVES, which is the only thing the reader can check.
    key: "home_value",
    title: "Your street, monthly",
    desc: "What sold near a home you follow last month — how many, how fast, and how many went above asking.",
    sender: "scripts/worker/streetRecap.ts",
    // NOT ARMED. street-recap.yml is workflow_dispatch-only and has no pg_cron row, so this
    // has never sent: 0 of 538 addresses as of 2026-09-21. Set this once the pg_cron entry
    // exists (and register the workflow in schedule-watchdog.yml at the same time, per the
    // note in street-recap.yml) — until then the toggle must not be on /account/emails.
    armedBy: null,
  },
  {
    key: "product",
    title: "Product news",
    desc: "Occasional notes when we ship something new. No fluff.",
    sender: null, // no sender planned yet
    armedBy: null,
  },
];

/**
 * The streams the preference centre may show.
 *
 * BOTH conditions, not either. A sender that nothing calls delivers exactly as much mail as
 * no sender at all, so a switch in front of it is the same lie — see `armedBy`.
 */
export const LIVE_EMAIL_STREAMS: EmailStream[] = EMAIL_STREAMS.filter(
  (s) => s.sender !== null && s.armedBy !== null
);
