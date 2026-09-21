/**
 * Address deliverability — the check every sender owes the sending domain.
 *
 * WHY THIS EXISTS (measured 2026-09-21). The weekly Data Drop selects its audience with a
 * bare page over `profiles`, gated only by consent. Nothing in that path asks whether an
 * address can receive mail. `profiles` holds 98 QA accounts on `@pureproperty-qa.test`, and
 * `.test` is an RFC 2606 reserved TLD: it has no NS record, it never will, and every send
 * to it is a guaranteed hard bounce. Against a ~320-send run that is a bounce rate over
 * 30%.
 *
 * A bounce rate is not a cosmetic metric. Mailbox providers throttle or block a domain above
 * roughly 5%, and `pureproperty.ca` is the SAME domain that carries sign-in codes — so a
 * marketing list full of synthetic addresses degrades the deliverability of authentication.
 * That is the real cost, and it is why this guard sits on the shared send path rather than
 * in the one worker that happened to expose it.
 *
 * WHAT THIS IS NOT. It is not list hygiene for addresses that bounce for ordinary reasons —
 * a closed mailbox, a full quota, a typo'd real domain. Those need the provider's own bounce
 * record, which arrives asynchronously long after a send is accepted. This module answers
 * only the question that can be answered locally and with certainty: could this address
 * EVER have received mail? Anything uncertain is deliverable, because refusing to mail a
 * real subscriber is worse than one bounce.
 */

/**
 * Top-level domains reserved by the IETF as permanently unresolvable.
 *
 * RFC 2606 §2 reserves `.test`, `.example`, `.invalid` and `.localhost` precisely so they
 * can be used in documentation and testing without ever colliding with real traffic. RFC
 * 6761 restates them as special-use names that resolvers must not send to the public DNS.
 * Mail to any of them cannot be delivered by definition, not by accident.
 */
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);

/**
 * Second-level names reserved for documentation by RFC 2606 §3. These DO resolve, and they
 * are operated by IANA, which discards the mail — so a send is accepted, counts against the
 * domain, and reaches nobody.
 */
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

/** The reason an address cannot be mailed, or null when it can. */
export type UndeliverableReason =
  | "malformed"
  | "reserved_tld"
  | "reserved_domain";

/**
 * Why this address can never receive mail, or null if it might.
 *
 * DELIBERATELY CONSERVATIVE. The only rejections here are addresses that are structurally
 * incapable of delivery. A real-looking address with a dead mailbox passes this check and
 * should — the provider's bounce record is what settles those, and guessing costs a
 * subscriber.
 */
export function undeliverableReason(email: string | null | undefined): UndeliverableReason | null {
  const e = (email ?? "").trim().toLowerCase();

  // One "@", something either side, and a dot-bearing domain. Resend rejects the rest
  // anyway; catching it here keeps a malformed row out of the send count.
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return "malformed";
  const domain = e.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return "malformed";
  if (/\s/.test(e)) return "malformed";

  if (RESERVED_DOMAINS.has(domain)) return "reserved_domain";

  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.has(tld)) return "reserved_tld";

  return null;
}

/** True when this address is safe to hand to the provider. */
export function isDeliverable(email: string | null | undefined): boolean {
  return undeliverableReason(email) === null;
}

/**
 * Split a recipient list into the addresses worth sending and the ones that would bounce.
 *
 * Returned as two arrays rather than filtered in place so a worker can REPORT what it
 * dropped. A silent filter is how a list quietly becomes half its size with nobody noticing
 * — the same failure mode as a sender that counts rejected sends as delivered.
 */
export function partitionDeliverable<T>(
  rows: readonly T[],
  emailOf: (row: T) => string | null | undefined
): { sendable: T[]; undeliverable: Array<{ row: T; reason: UndeliverableReason }> } {
  const sendable: T[] = [];
  const undeliverable: Array<{ row: T; reason: UndeliverableReason }> = [];
  for (const row of rows) {
    const reason = undeliverableReason(emailOf(row));
    if (reason) undeliverable.push({ row, reason });
    else sendable.push(row);
  }
  return { sendable, undeliverable };
}
