import { describe, expect, it } from "vitest";
import { canSendAlerts, canSendOnboarding, gapDaysForCadence, ONBOARDING_MIN_GAP_DAYS } from "./sendPolicy";

const NOW = 1_800_000_000_000; // fixed epoch ms
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("canSendOnboarding", () => {
  it("allows a fresh message with no prior state", () => {
    expect(canSendOnboarding({ messageId: "onboarding_add_area", now: NOW })).toBe(true);
  });

  it("blocks when master-unsubscribed", () => {
    expect(
      canSendOnboarding({ messageId: "x", now: NOW, marketingOptOut: true })
    ).toBe(false);
  });

  it("blocks when the onboarding stream is off", () => {
    expect(
      canSendOnboarding({ messageId: "x", now: NOW, prefs: { onboarding: false } })
    ).toBe(false);
  });

  it("blocks during an active pause, allows once it has passed", () => {
    expect(
      canSendOnboarding({ messageId: "x", now: NOW, prefs: { pause_until: iso(NOW + DAY) } })
    ).toBe(false);
    expect(
      canSendOnboarding({ messageId: "x", now: NOW, prefs: { pause_until: iso(NOW - DAY) } })
    ).toBe(true);
  });

  it("blocks a message already sent (idempotency)", () => {
    expect(
      canSendOnboarding({
        messageId: "onboarding_add_area",
        now: NOW,
        lifecycle: { sent: { onboarding_add_area: iso(NOW - 30 * DAY) } },
      })
    ).toBe(false);
  });

  it("enforces the frequency cap on last_sent_at", () => {
    // 1 day ago < 2-day standard gap → blocked
    expect(
      canSendOnboarding({ messageId: "new_msg", now: NOW, lifecycle: { last_sent_at: iso(NOW - 1 * DAY) } })
    ).toBe(false);
    // 3 days ago > gap → allowed
    expect(
      canSendOnboarding({ messageId: "new_msg", now: NOW, lifecycle: { last_sent_at: iso(NOW - 3 * DAY) } })
    ).toBe(true);
  });

  it("'minimal' cadence suppresses the drip entirely; 'reduced' widens the gap", () => {
    expect(gapDaysForCadence("standard")).toBe(ONBOARDING_MIN_GAP_DAYS);
    expect(gapDaysForCadence("reduced")).toBe(7);
    expect(gapDaysForCadence("minimal")).toBe(Infinity);
    expect(
      canSendOnboarding({ messageId: "x", now: NOW, prefs: { cadence: "minimal" } })
    ).toBe(false);
    // reduced: a 3-day-old send is still inside the 7-day gap → blocked
    expect(
      canSendOnboarding({
        messageId: "x",
        now: NOW,
        prefs: { cadence: "reduced" },
        lifecycle: { last_sent_at: iso(NOW - 3 * DAY) },
      })
    ).toBe(false);
  });
});

describe("canSendAlerts", () => {
  it("allows a user with no preference row (missing row = all streams on)", () => {
    expect(canSendAlerts({ now: NOW })).toBe(true);
    expect(canSendAlerts({ now: NOW, prefs: null })).toBe(true);
    expect(canSendAlerts({ now: NOW, prefs: {} })).toBe(true);
  });

  it("blocks when master-unsubscribed", () => {
    expect(canSendAlerts({ now: NOW, marketingOptOut: true })).toBe(false);
  });

  it("blocks when the alerts stream is off", () => {
    expect(canSendAlerts({ now: NOW, prefs: { alerts: false } })).toBe(false);
    expect(canSendAlerts({ now: NOW, prefs: { alerts: true } })).toBe(true);
  });

  it("blocks during an active pause, allows once it has passed", () => {
    expect(canSendAlerts({ now: NOW, prefs: { pause_until: iso(NOW + DAY) } })).toBe(false);
    expect(canSendAlerts({ now: NOW, prefs: { pause_until: iso(NOW - DAY) } })).toBe(true);
    expect(canSendAlerts({ now: NOW, prefs: { pause_until: null } })).toBe(true);
  });

  it("ignores cadence — both non-standard settings promise the digest survives", () => {
    // "Only the essentials — just alerts you set and account messages" names the digest
    // as a keeper, so 'minimal' must NOT suppress it (unlike the drip).
    expect(canSendAlerts({ now: NOW, prefs: { cadence: "minimal" } })).toBe(true);
    expect(canSendAlerts({ now: NOW, prefs: { cadence: "reduced" } })).toBe(true);
    expect(canSendOnboarding({ messageId: "x", now: NOW, prefs: { cadence: "minimal" } })).toBe(false);
  });

  it("fails OPEN on an unparseable pause date rather than muting a requested alert", () => {
    expect(canSendAlerts({ now: NOW, prefs: { pause_until: "not-a-date" } })).toBe(true);
  });
});
