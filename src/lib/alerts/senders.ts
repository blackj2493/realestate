/**
 * Canonical sender identities for every user-facing email (voice.md §11.8).
 *
 * `pureproperty.ca` is Resend-verified, so ANY `<addr>@pureproperty.ca` From works with
 * no per-address setup. A `replyTo` only needs a real Microsoft 365 mailbox if we expect
 * replies to land there (e.g. `tanmay@` for lead follow-ups, `support@` for confirmations).
 *
 * `ALERTS_FROM_EMAIL` still overrides the automated alert stream so ops can repoint the
 * sender without a deploy — but update that env var to an `alerts@` value or the current
 * env value (`support@`) will keep winning over the default below.
 */
export interface Sender {
  from: string;
  replyTo?: string;
}

const ALERTS_FROM =
  process.env.ALERTS_FROM_EMAIL || "PureProperty Alerts <alerts@pureproperty.ca>";

export const SENDERS = {
  /** Nightly digest + single-listing price/status alerts. Automated, unmonitored. */
  alerts: { from: ALERTS_FROM },
  /** Sign-up confirmation (first touch). Automated; replies go to a monitored inbox. */
  confirmation: { from: ALERTS_FROM, replyTo: "support@pureproperty.ca" },
  /** Welcome / activation. Machine sender — deliberately NOT the Tanmay persona (§3). */
  welcome: { from: "PureProperty <hello@pureproperty.ca>", replyTo: "support@pureproperty.ca" },
  /** Lead follow-up (Tier-0). Human identity; replies land with the real person. */
  leadFollowUp: {
    from: "Tanmay at PureProperty <tanmay@pureproperty.ca>",
    replyTo: "tanmay@pureproperty.ca",
  },
} satisfies Record<string, Sender>;
