import { describe, expect, it, beforeAll } from "vitest";
import {
  emailActionUrl,
  signEmailAction,
  signUnsubscribe,
  verifyEmailAction,
  EMAIL_ACTIONS,
  RESUBSCRIBE_ACTIONS,
  isResubscribe,
  frequencyForAction,
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

/**
 * The two recovery actions, offered only on the unsubscribe confirmation page. They clear
 * `profiles.marketing_opt_out`, which no other action does — so the thing that must hold is
 * that no OTHER action's link can ever be turned into one of these.
 */
describe("recovery actions", () => {
  it("cannot be reached by editing a preference link", () => {
    // Every digest already delivered carries a valid `weekly` link. An unsubscribed reader
    // finding an old one must change a preference, never rejoin the list they left.
    for (const from of ["weekly", "daily", "pause30"] as const) {
      const sig = signEmailAction(EMAIL, from);
      for (const to of RESUBSCRIBE_ACTIONS) {
        expect(verifyEmailAction(EMAIL, to, sig), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("cannot be edited into a preference action either", () => {
    for (const from of RESUBSCRIBE_ACTIONS) {
      const sig = signEmailAction(EMAIL, from);
      for (const to of ["weekly", "daily", "pause30"] as const) {
        expect(verifyEmailAction(EMAIL, to, sig), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("cannot be signed for one address and used for another", () => {
    const sig = signEmailAction(EMAIL, "resub_weekly");
    expect(verifyEmailAction("someone.else@example.com", "resub_weekly", sig)).toBe(false);
  });

  it("verifies its own links", () => {
    for (const action of RESUBSCRIBE_ACTIONS) {
      expect(verifyEmailAction(EMAIL, action, signEmailAction(EMAIL, action))).toBe(true);
    }
  });

  it("is listed as a known action, so an unknown string is still rejected", () => {
    expect(EMAIL_ACTIONS).toContain("resub_weekly");
    expect(EMAIL_ACTIONS).toContain("resub_daily");
    expect(verifyEmailAction(EMAIL, "resub_monthly", signEmailAction(EMAIL, "resub_weekly"))).toBe(false);
  });
});

describe("isResubscribe / frequencyForAction", () => {
  it("names exactly the actions that re-consent", () => {
    expect(isResubscribe("resub_weekly")).toBe(true);
    expect(isResubscribe("resub_daily")).toBe(true);
    expect(isResubscribe("weekly")).toBe(false);
    expect(isResubscribe("daily")).toBe(false);
    expect(isResubscribe("pause30")).toBe(false);
  });

  it("maps each action to the cadence it asks for", () => {
    expect(frequencyForAction("weekly")).toBe("weekly");
    expect(frequencyForAction("resub_weekly")).toBe("weekly");
    expect(frequencyForAction("daily")).toBe("daily");
    expect(frequencyForAction("resub_daily")).toBe("daily");
    // A pause asks for no cadence at all — the route must not write one.
    expect(frequencyForAction("pause30")).toBeNull();
  });
});
