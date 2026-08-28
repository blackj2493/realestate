import { describe, expect, it } from "vitest";
import {
  canSendAlerts,
  canSendDataDrop,
  canSendOnboarding,
  gapDaysForCadence,
  ONBOARDING_MIN_GAP_DAYS,
} from "./sendPolicy";

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

describe("canSendDataDrop", () => {
  const WEEK = "data_drop:2026-W36";

  it("allows a user with no prefs and no history", () => {
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW })).toBe(true);
  });

  it("blocks when master-unsubscribed", () => {
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, marketingOptOut: true })).toBe(false);
  });

  it("blocks when the weekly stream is switched off", () => {
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, prefs: { data_drop: false } })).toBe(false);
  });

  it("blocks during an active pause and allows after it lapses", () => {
    expect(
      canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, prefs: { pause_until: iso(NOW + DAY) } })
    ).toBe(false);
    expect(
      canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, prefs: { pause_until: iso(NOW - DAY) } })
    ).toBe(true);
  });

  // The mirror of the canSendAlerts cadence tests, and deliberately the opposite answer.
  // "Fewer emails — at most one non-urgent email a week" describes THIS email exactly, so
  // 'reduced' keeps it; "only the essentials" does not describe a weekly we send unprompted.
  it("still sends at 'reduced' cadence, and never at 'minimal'", () => {
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, prefs: { cadence: "reduced" } })).toBe(true);
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, prefs: { cadence: "minimal" } })).toBe(false);
  });

  // The stamped id carries the chosen headline kind, but the kind is derived from board data
  // that moves between a failed send and its retry. An exact-key check would let the same
  // week go out twice under a different suffix.
  it("matches the week by PREFIX, so a different headline kind cannot re-send it", () => {
    const lifecycle = { sent: { "data_drop:2026-W36:leverage": iso(NOW - DAY) } };
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, lifecycle })).toBe(false);
  });

  it("allows the following week once the previous one is stamped", () => {
    const lifecycle = { sent: { "data_drop:2026-W35:speed": iso(NOW - 7 * DAY) } };
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, lifecycle })).toBe(true);
  });

  // The onboarding frequency cap must not leak across: a drip sent two days ago is no reason
  // to skip somebody's weekly market email.
  it("is not gated by the onboarding frequency cap", () => {
    const lifecycle = { sent: { onboarding_add_area: iso(NOW - DAY) }, last_sent_at: iso(NOW - DAY) };
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, lifecycle })).toBe(true);
  });
});
