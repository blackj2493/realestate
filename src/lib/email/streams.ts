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
 * `sender` names the code that sends it. To launch a stream, ship its sender, then fill in
 * `sender` here — the UI picks it up with no further change.
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
}

export const EMAIL_STREAMS: EmailStream[] = [
  {
    key: "alerts",
    title: "Saved home & area alerts",
    desc: "New listings, price drops, and sales for the homes and areas you follow.",
    sender: "scripts/worker/alerts.ts",
  },
  {
    key: "onboarding",
    title: "Getting-started tips",
    desc: "A few short guides to help you set up and get the most out of PureProperty.",
    sender: "scripts/worker/onboarding.ts",
  },
  {
    key: "data_drop",
    title: "Weekly market update",
    desc: "One email a week on what's moving in the markets you follow.",
    sender: "scripts/worker/dataDrop.ts",
  },
  {
    key: "home_value",
    title: "Your home's value",
    desc: "When the estimated value of a home you own moves — plus a monthly recap.",
    sender: null, // WS3 — needs user_homes first
  },
  {
    key: "product",
    title: "Product news",
    desc: "Occasional notes when we ship something new. No fluff.",
    sender: null, // no sender planned yet
  },
];

/** The streams the preference centre may show — those a sender actually exists for. */
export const LIVE_EMAIL_STREAMS: EmailStream[] = EMAIL_STREAMS.filter((s) => s.sender !== null);
