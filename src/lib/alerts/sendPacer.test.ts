/**
 * sendPacer tests — the regression that matters is the 2026-09 incident: a rejected send
 * must NEVER report as sent, because the caller advances a watermark on that answer and a
 * false "sent" destroys the alert rather than delaying it.
 */
import { describe, it, expect, vi } from "vitest";
import { createSendPacer } from "./sendPacer";
import type { SendResult } from "./sendEmail";

const input = { kind: "test", to: "a@example.com", from: "x@example.com", subject: "s", text: "t" };

/** Deterministic clock + no real waiting; records what the pacer asked to sleep for. */
function harness(results: SendResult[]) {
  const waits: number[] = [];
  let clock = 0;
  const send = vi.fn(async () => results.shift() ?? { sent: true });
  const pacer = createSendPacer({
    perSecond: 2,
    send,
    now: () => clock,
    wait: async (ms: number) => {
      waits.push(ms);
      clock += ms;
    },
  });
  return { pacer, send, waits, tick: (ms: number) => (clock += ms) };
}

describe("sendPacer outcomes", () => {
  it("reports a provider-returned error as NOT sent", async () => {
    // The whole incident in one assertion: resend.emails.send resolves with { error } and
    // does not throw, so a try/catch saw success. sent:false must surface as failed.
    const { pacer } = harness([{ sent: false, error: "validation_error: bad address" }]);
    const out = await pacer.send(input);
    expect(out.status).toBe("failed");
    expect(pacer.stats()).toMatchObject({ sent: 0, failed: 1 });
  });

  it("reports a successful send as sent, with the provider id", async () => {
    const { pacer } = harness([{ sent: true, id: "abc" }]);
    expect(await pacer.send(input)).toEqual({ status: "sent", id: "abc" });
    expect(pacer.stats()).toMatchObject({ sent: 1, failed: 0 });
  });
});

describe("sendPacer retries", () => {
  it("retries a rate limit and reports the eventual success", async () => {
    const { pacer, send, waits } = harness([
      { sent: false, error: "rate_limit_exceeded: Too many requests" },
      { sent: false, error: "rate_limit_exceeded: Too many requests" },
      { sent: true, id: "ok" },
    ]);
    expect(await pacer.send(input)).toEqual({ status: "sent", id: "ok" });
    expect(send).toHaveBeenCalledTimes(3);
    expect(pacer.stats()).toMatchObject({ sent: 1, failed: 0, retries: 2 });
    // Backoff grows: the pacing interval (500ms at 2/s) plus 1s then 2s.
    expect(waits).toContain(1000);
    expect(waits).toContain(2000);
  });

  it("gives up after maxRetries and reports failed, not sent", async () => {
    const { pacer, send } = harness([
      { sent: false, error: "429 Too Many Requests" },
      { sent: false, error: "429 Too Many Requests" },
      { sent: false, error: "429 Too Many Requests" },
      { sent: false, error: "429 Too Many Requests" },
    ]);
    const out = await pacer.send(input);
    expect(out.status).toBe("failed");
    expect(send).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it("does not retry an error that retrying cannot fix", async () => {
    const { pacer, send } = harness([{ sent: false, error: "validation_error: invalid `to`" }]);
    expect((await pacer.send(input)).status).toBe("failed");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries transport faults too", async () => {
    const { pacer, send } = harness([{ sent: false, error: "fetch failed ECONNRESET" }, { sent: true }]);
    expect((await pacer.send(input)).status).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("sendPacer quota latch", () => {
  it("classifies a quota error as quota, not a retryable rate limit", async () => {
    const { pacer, send } = harness([{ sent: false, error: "daily_quota_exceeded: upgrade your plan" }]);
    const out = await pacer.send(input);
    expect(out.status).toBe("quota");
    // Retrying an exhausted quota is pure waste — one attempt, then stop.
    expect(send).toHaveBeenCalledTimes(1);
    expect(pacer.stopped).toBe(true);
  });

  it("short-circuits every later send once the quota latched", async () => {
    const { pacer, send } = harness([{ sent: false, error: "You have reached your daily quota" }]);
    await pacer.send(input);
    const calls = send.mock.calls.length;
    for (let i = 0; i < 5; i++) expect((await pacer.send(input)).status).toBe("quota");
    // No further requests: the point is to stop burning the batch against a hard limit.
    expect(send).toHaveBeenCalledTimes(calls);
    expect(pacer.stats()).toMatchObject({ skippedAfterQuota: 5, quotaHit: true });
  });

  it("stays open when nothing has failed", async () => {
    const { pacer } = harness([]);
    await pacer.send(input);
    expect(pacer.stopped).toBe(false);
    expect(pacer.stats().quotaHit).toBe(false);
  });
});

describe("sendPacer rate limiting", () => {
  it("spaces sends to the configured rate", async () => {
    const { pacer, waits } = harness([]);
    for (let i = 0; i < 4; i++) await pacer.send(input);
    // 2/second → a 500ms slot between attempts. The first is free.
    expect(waits.filter((w) => w === 500)).toHaveLength(3);
  });

  it("does not sleep when the caller was already slow enough", async () => {
    const { pacer, waits, tick } = harness([]);
    await pacer.send(input);
    tick(5000); // a slow render between sends
    await pacer.send(input);
    expect(waits).toHaveLength(0);
  });

  it("reads RESEND_SENDS_PER_SECOND when no rate is passed", async () => {
    const prev = process.env.RESEND_SENDS_PER_SECOND;
    process.env.RESEND_SENDS_PER_SECOND = "4";
    try {
      const waits: number[] = [];
      let clock = 0;
      const pacer = createSendPacer({
        send: async () => ({ sent: true }),
        now: () => clock,
        wait: async (ms) => {
          waits.push(ms);
          clock += ms;
        },
      });
      await pacer.send(input);
      await pacer.send(input);
      expect(waits).toEqual([250]); // 4/second
    } finally {
      if (prev === undefined) delete process.env.RESEND_SENDS_PER_SECOND;
      else process.env.RESEND_SENDS_PER_SECOND = prev;
    }
  });
});
