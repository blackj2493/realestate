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
  /**
   * Weekly Data Drop — the editorial/marketing stream (WS2).
   *
   * LITERAL BY DESIGN: it must NOT read ALERTS_FROM_EMAIL. That variable currently resolves
   * to `support@` and wins over every default that consults it, so a Data Drop that read it
   * would silently revert to the support identity and nobody would notice for weeks.
   *
   * REPLY-TO IS DELIBERATE, not an oversight. A weekly market email draws real replies
   * ("what about Guelph?"). Replies are among the strongest positive signals Gmail weighs,
   * and they are the best engagement data this stream can produce. Do not make it
   * unmonitored the way the automated alert stream is.
   *
   * TODO(Unit 1): move to `data@send.pureproperty.ca` once the send subdomain is verified in
   * Resend, so recurring marketing volume stops riding the reputation that delivers sign-in
   * codes (voice.md §11.7 item 2). The root domain is already Resend-verified, so this
   * address works today and only the host changes.
   */
  dataDrop: {
    from: "PureProperty Data <data@pureproperty.ca>",
    replyTo: "support@pureproperty.ca",
  },
} satisfies Record<string, Sender>;
