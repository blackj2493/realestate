import { describe, expect, it, beforeAll } from "vitest";
import {
  emailActionUrl,
  signEmailAction,
  signUnsubscribe,
  verifyEmailAction,
  EMAIL_ACTIONS,
} from "./unsubscribe";

beforeAll(() => {
  process.env.ALERTS_UNSUBSCRIBE_SECRET = "test-secret-for-email-actions";
});

const EMAIL = "Reader@Example.com";

describe("signed email actions", () => {
  it("verifies a link it signed, whatever the case of the address", () => {
    const sig = signEmailAction(EMAIL, "weekly");
    expect(verifyEmailAction(EMAIL, "weekly", sig)).toBe(true);
    expect(verifyEmailAction("reader@example.com", "weekly", sig)).toBe(true);
    expect(verifyEmailAction("  READER@EXAMPLE.COM ", "weekly", sig)).toBe(true);
  });

  it("will not let one action's link be edited into another's", () => {
    // The whole reason the action is inside the signature: otherwise anyone holding a
    // "pause for 30 days" link could rewrite the query string into any other action for
    // that address, including one the reader never asked for.
    const weekly = signEmailAction(EMAIL, "weekly");
    for (const other of EMAIL_ACTIONS.filter((a) => a !== "weekly")) {
      expect(verifyEmailAction(EMAIL, other, weekly)).toBe(false);
    }
  });

  it("is not interchangeable with the unsubscribe signature", () => {
    expect(verifyEmailAction(EMAIL, "weekly", signUnsubscribe(EMAIL))).toBe(false);
  });

  it("refuses an unknown action, a wrong address and a missing signature", () => {
    const sig = signEmailAction(EMAIL, "daily");
    expect(verifyEmailAction(EMAIL, "delete-account", sig)).toBe(false);
    expect(verifyEmailAction("someone@else.test", "daily", sig)).toBe(false);
    expect(verifyEmailAction(EMAIL, "daily", "")).toBe(false);
    expect(verifyEmailAction("", "daily", sig)).toBe(false);
  });

  it("builds a URL the route can read back", () => {
    const url = new URL(emailActionUrl(EMAIL, "pause30", "https://www.pureproperty.ca/"));
    expect(url.pathname).toBe("/api/email/alert-frequency");
    expect(url.searchParams.get("a")).toBe("pause30");
    expect(url.searchParams.get("e")).toBe("reader@example.com");
    expect(
      verifyEmailAction(url.searchParams.get("e")!, url.searchParams.get("a")!, url.searchParams.get("s")!)
    ).toBe(true);
  });
});
