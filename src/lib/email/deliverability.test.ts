import { describe, expect, it } from "vitest";
import { isDeliverable, partitionDeliverable, undeliverableReason } from "./deliverability";

/**
 * The incident these guard (2026-09-21): 98 `@pureproperty-qa.test` rows in `profiles`
 * reached the weekly Data Drop's audience, which pages `profiles` and gates only on
 * consent. `.test` can never resolve, so each send hard-bounced and one run posted a
 * bounce rate above 30% on the same domain that carries sign-in codes.
 */
describe("undeliverableReason", () => {
  it("rejects the QA domain that caused the bounce spike", () => {
    expect(undeliverableReason("qa-1234@pureproperty-qa.test")).toBe("reserved_tld");
  });

  it("rejects every RFC 2606 reserved TLD", () => {
    for (const tld of ["test", "example", "invalid", "localhost", "local"]) {
      expect(undeliverableReason(`someone@host.${tld}`), tld).toBe("reserved_tld");
    }
  });

  it("rejects the documentation domains, which accept mail and discard it", () => {
    expect(undeliverableReason("a@example.com")).toBe("reserved_domain");
    expect(undeliverableReason("a@example.net")).toBe("reserved_domain");
    expect(undeliverableReason("a@example.org")).toBe("reserved_domain");
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "   ", "nobody", "@host.com", "user@", "user@host", "a b@host.com"]) {
      expect(undeliverableReason(bad), JSON.stringify(bad)).toBe("malformed");
    }
    expect(undeliverableReason(null)).toBe("malformed");
    expect(undeliverableReason(undefined)).toBe("malformed");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(undeliverableReason("  QA@PureProperty-QA.TEST  ")).toBe("reserved_tld");
  });

  /**
   * The conservative half of the contract. A dead mailbox at a real domain must pass —
   * only the provider's bounce record can settle those, and guessing costs a subscriber.
   */
  it("passes real addresses, including ones that may well bounce", () => {
    for (const good of [
      "someone@gmail.com",
      "someone@pureproperty.ca",
      "first.last+tag@sub.domain.co.uk",
      "closed-mailbox@rogers.com",
      "typo@gmial.com",
      "someone@testing.com", // 'test' only as a TLD, never as a substring
      "someone@example.company.com",
    ]) {
      expect(isDeliverable(good), good).toBe(true);
    }
  });
});

describe("partitionDeliverable", () => {
  it("splits a list and keeps the reason with each dropped row", () => {
    const rows = [
      { email: "real@gmail.com" },
      { email: "qa@pureproperty-qa.test" },
      { email: "also.real@outlook.com" },
      { email: "broken" },
    ];
    const { sendable, undeliverable } = partitionDeliverable(rows, (r) => r.email);
    expect(sendable.map((r) => r.email)).toEqual(["real@gmail.com", "also.real@outlook.com"]);
    expect(undeliverable.map((u) => [u.row.email, u.reason])).toEqual([
      ["qa@pureproperty-qa.test", "reserved_tld"],
      ["broken", "malformed"],
    ]);
  });

  it("reports what it dropped rather than filtering silently", () => {
    const { sendable, undeliverable } = partitionDeliverable(
      [{ email: "a@b.test" }],
      (r) => r.email
    );
    expect(sendable).toHaveLength(0);
    // The count is the point: a worker that drops rows without saying so is how a list
    // quietly halves with nobody noticing.
    expect(undeliverable).toHaveLength(1);
  });
});
