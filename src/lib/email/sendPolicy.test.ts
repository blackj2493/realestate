import { describe, expect, it } from "vitest";
import {
  canSendAlerts,
  canSendDataDrop,
  canSendOnboarding,
  gapDaysForCadence,
  digestSentToday,
  lastDataDropAt,
  DIGEST_MESSAGE_ID,
  DEFERRAL_RELEASE_DAYS,
  ONBOARDING_MIN_GAP_DAYS,
  canSendStreetRecap,
  RECAP_DEFERRAL_RELEASE_DAYS,
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

/**
 * The same-day collision rule. On a Thursday the nightly digest lands at 06:47 UTC and the
 * Data Drop at 11:40 UTC, and every ramp recipient has a saved market — so without this
 * most of them get two emails inside five hours.
 */
describe("canSendDataDrop — the digest collision", () => {
  const WEEK = "data_drop:2026-W36";
  const priorDrop = (at: number) => ({ "data_drop:2026-W30:price": iso(at) });

  it("stands down when the digest already reached them today", () => {
    const lifecycle = {
      sent: { ...priorDrop(NOW - 7 * DAY), [DIGEST_MESSAGE_ID]: iso(NOW) },
    };
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, lifecycle })).toBe(false);
  });

  it("sends anyway when the digest was on a different day", () => {
    const lifecycle = {
      sent: { ...priorDrop(NOW - 7 * DAY), [DIGEST_MESSAGE_ID]: iso(NOW - 2 * DAY) },
    };
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, lifecycle })).toBe(true);
  });

  // Ramp week 1 is 107 people who ALL have a saved market. A blanket rule could have cut
  // that send to a fraction of itself, silently, and only shown up weeks later.
  it("never defers a user's FIRST Data Drop", () => {
    const lifecycle = { sent: { [DIGEST_MESSAGE_ID]: iso(NOW) } };
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, lifecycle })).toBe(true);
  });

  // Otherwise a user whose saved areas produce a digest most nights would be deferred every
  // Thursday forever — the most engaged people would be the only ones never to see it.
  it("releases once the user is overdue, digest or not", () => {
    const stale = NOW - (DEFERRAL_RELEASE_DAYS + 1) * DAY;
    const lifecycle = { sent: { ...priorDrop(stale), [DIGEST_MESSAGE_ID]: iso(NOW) } };
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, lifecycle })).toBe(true);
  });

  it("still defers just inside the release window", () => {
    const recent = NOW - (DEFERRAL_RELEASE_DAYS - 1) * DAY;
    const lifecycle = { sent: { ...priorDrop(recent), [DIGEST_MESSAGE_ID]: iso(NOW) } };
    expect(canSendDataDrop({ weekKeyPrefix: WEEK, now: NOW, lifecycle })).toBe(false);
  });
});

describe("digestSentToday", () => {
  it("is false with no stamp, and true on the same day", () => {
    expect(digestSentToday(null, NOW)).toBe(false);
    expect(digestSentToday({}, NOW)).toBe(false);
    expect(digestSentToday({ [DIGEST_MESSAGE_ID]: iso(NOW) }, NOW)).toBe(true);
  });

  it("does not throw on an unparseable stamp", () => {
    expect(digestSentToday({ [DIGEST_MESSAGE_ID]: "not-a-date" }, NOW)).toBe(false);
  });
});

describe("lastDataDropAt", () => {
  it("takes the newest data_drop stamp and ignores every other stream", () => {
    const sent = {
      "data_drop:2026-W30:price": iso(NOW - 40 * DAY),
      "data_drop:2026-W34:speed": iso(NOW - 12 * DAY),
      onboarding_add_area: iso(NOW - DAY),
      [DIGEST_MESSAGE_ID]: iso(NOW),
    };
    expect(lastDataDropAt(sent)).toBe(NOW - 12 * DAY);
  });

  it("is null when they have never had one", () => {
    expect(lastDataDropAt({ onboarding_add_area: iso(NOW) })).toBeNull();
    expect(lastDataDropAt(null)).toBeNull();
  });
});

/**
 * The monthly Street Recap. Same shape of gate as the Data Drop, one deliberate difference:
 * the deferral release is far longer, because a monthly email deferred on the 21-day rule
 * would release every single month and the cap would never bind.
 */
describe("canSendStreetRecap", () => {
  const MONTH = "street_recap:2026-09";
  const priorRecap = (at: number) => ({ "street_recap:2026-07": iso(at) });

  it("allows a person with no prefs and no history", () => {
    expect(canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW })).toBe(true);
  });

  it("blocks when the stream is switched off", () => {
    expect(
      canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW, prefs: { home_value: false } })
    ).toBe(false);
  });

  it("blocks under master unsubscribe, an active pause, and 'minimal'", () => {
    expect(canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW, marketingOptOut: true })).toBe(false);
    expect(
      canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW, prefs: { pause_until: iso(NOW + DAY) } })
    ).toBe(false);
    expect(
      canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW, prefs: { cadence: "minimal" } })
    ).toBe(false);
  });

  // "Fewer emails — at most one non-urgent email a week" is a promise a MONTHLY email
  // cannot break, so 'reduced' keeps it.
  it("survives the 'reduced' cadence", () => {
    expect(
      canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW, prefs: { cadence: "reduced" } })
    ).toBe(true);
  });

  it("sends once a month, matching on the month prefix", () => {
    const lifecycle = { sent: { "street_recap:2026-09": iso(NOW - 2 * DAY) } };
    expect(canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW, lifecycle })).toBe(false);
    expect(
      canSendStreetRecap({ monthKeyPrefix: "street_recap:2026-10", now: NOW, lifecycle })
    ).toBe(true);
  });

  it("defers on a same-day digest, but never the first recap", () => {
    const first = { sent: { [DIGEST_MESSAGE_ID]: iso(NOW) } };
    expect(canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW, lifecycle: first })).toBe(true);

    const repeat = { sent: { ...priorRecap(NOW - 30 * DAY), [DIGEST_MESSAGE_ID]: iso(NOW) } };
    expect(canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW, lifecycle: repeat })).toBe(false);
  });

  it("releases after the longer monthly window, so a deferral costs one month at most", () => {
    const stale = { sent: { ...priorRecap(NOW - 41 * DAY), [DIGEST_MESSAGE_ID]: iso(NOW) } };
    expect(canSendStreetRecap({ monthKeyPrefix: MONTH, now: NOW, lifecycle: stale })).toBe(true);
    // The Data Drop's 21 days would have released this one and defeated the cap entirely.
    expect(RECAP_DEFERRAL_RELEASE_DAYS).toBeGreaterThan(DEFERRAL_RELEASE_DAYS);
  });
});
