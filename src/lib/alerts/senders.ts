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
   * ON THE SEND SUBDOMAIN since 2026-09-24 (verified in Resend the same day). Recurring
   * marketing volume no longer rides the reputation that delivers sign-in codes — a
   * separation this stream needed badly: one week earlier it posted a 33% bounce rate on the
   * root domain, because the audience query had no deliverability gate and mailed 98 QA
   * accounts on a reserved TLD (see src/lib/email/deliverability.ts). That is fixed, and the
   * 09-24 send bounced 0.9% — but the structural point stands whatever this week's rate is.
   *
   * The REPLY-TO stays on the root domain on purpose. Replies must land in the real
   * `support@` mailbox; only the sending identity moves.
   *
   * A FRESH SUBDOMAIN HAS NO REPUTATION, so expect a dip for a week or two at this volume
   * (~330/week). Check `last_event` on the first two sends rather than assuming.
   */
  dataDrop: {
    from: "PureProperty Data <data@send.pureproperty.ca>",
    replyTo: "support@pureproperty.ca",
  },
  /**
   * Monthly Street Recap — the owner stream.
   *
   * LITERAL, for the same reason as dataDrop: reading ALERTS_FROM_EMAIL would silently
   * revert this to the support identity and nobody would notice for weeks.
   *
   * A SEPARATE IDENTITY FROM dataDrop, deliberately. The two say different things about why
   * the reader is hearing from us — one is the market, the other is their own street — and
   * somebody subscribed to both should be able to tell them apart in a threaded inbox
   * without opening either. It also makes the reply useful: a reply to this stream is about
   * one address, not about a market.
   *
   * STAYS ON THE ROOT DOMAIN for now, unlike dataDrop. `send.pureproperty.ca` is verified
   * and ready, but this stream is not armed — `street-recap.yml` has no schedule and no
   * pg_cron row, and `streams.ts` hides its toggle for exactly that reason. Moving a sender
   * that never sends would be a change nobody could verify. Move it in the same PR that
   * arms the stream, so the first send and the new identity are tested together.
   */
  streetRecap: {
    from: "PureProperty <homes@pureproperty.ca>",
    replyTo: "support@pureproperty.ca",
  },
} satisfies Record<string, Sender>;
