import { describe, it, expect } from "vitest";
import { delta, attention, subjectLine, pct, round1, type DailyMetricsInput, type DailyCounts } from "./dailyMetrics";

const counts = (o: Partial<DailyCounts> = {}): DailyCounts => ({
  visitors: 40,
  signups: 5,
  returning: 3,
  unsubscribes: 0,
  assetsCreated: 4,
  applications: 0,
  vowReads: 100,
  ...o,
});

const model = (o: Partial<DailyMetricsInput> = {}): DailyMetricsInput => ({
  day: "2026-09-05",
  today: counts(),
  prior7: counts(),
  activation: [],
  email: { digestSent: 120, digestFailed: 0, digestSuppressed: 10, sendFailures: 0 },
  leads: [],
  totals: { users: 391, optedOut: 26, withAnyAsset: 300 },
  ...o,
});

describe("delta", () => {
  it("stays flat when the absolute move is small, however large the percentage", () => {
    // 2 → 3 is +50% and means nothing at this volume. This is the whole reason the
    // report is readable: a daily email that shouts every morning gets filtered.
    expect(delta(3, 2).direction).toBe("flat");
    expect(delta(3, 2).label).toBe("—");
    expect(delta(0, 2).direction).toBe("flat");
  });

  it("stays flat when the percentage is small, however large the absolute move", () => {
    expect(delta(105, 100).direction).toBe("flat"); // +5 clears MIN_SIGNAL, +5% does not
  });

  it("calls a move only when both thresholds clear", () => {
    expect(delta(60, 40)).toMatchObject({ direction: "up", changePct: 50, label: "▲ 50%" });
    expect(delta(20, 40)).toMatchObject({ direction: "down", changePct: -50, label: "▼ 50%" });
  });

  it("never divides by a zero baseline", () => {
    expect(delta(9, 0)).toMatchObject({ direction: "flat", changePct: 0 });
  });
});

describe("attention", () => {
  it("is empty on an ordinary day", () => {
    // The contract. If this ever returns something for a normal day, the report becomes
    // noise and stops being read.
    expect(attention(model())).toEqual([]);
  });

  it("leads with applications to work", () => {
    const a = attention(model({ leads: [{ createdAt: "2026-09-05T14:00:00Z", kind: "application", who: "A" }] }));
    expect(a[0]).toMatchObject({ severity: "alert" });
    expect(a[0].text).toContain("1 new application");
  });

  it("flags an unsubscribe spike, but not a normal trickle", () => {
    expect(attention(model({ today: counts({ unsubscribes: 2 }) }))).toEqual([]);
    const spike = attention(model({ today: counts({ unsubscribes: 6 }), prior7: counts({ unsubscribes: 1 }) }));
    expect(spike.some((x) => x.text.includes("unsubscribes"))).toBe(true);
  });

  it("flags rejected email — the failure that used to be silent", () => {
    const a = attention(model({ email: { digestSent: 90, digestFailed: 33, digestSuppressed: 8, sendFailures: 0 } }));
    expect(a.some((x) => x.severity === "alert" && x.text.includes("REJECTED"))).toBe(true);
  });

  it("flags a digest that reached nobody while users have saved assets", () => {
    const a = attention(model({ email: { digestSent: 0, digestFailed: 0, digestSuppressed: 0, sendFailures: 0 } }));
    expect(a.some((x) => x.text.includes("sent 0 emails"))).toBe(true);
  });

  it("flags traffic with no signups, but not a quiet day", () => {
    expect(attention(model({ today: counts({ visitors: 5, signups: 0 }) })).some((x) => x.text.includes("0 signups"))).toBe(false);
    expect(attention(model({ today: counts({ visitors: 40, signups: 0 }) })).some((x) => x.text.includes("0 signups"))).toBe(true);
  });

  it("flags the structural hole: most of the base has saved nothing", () => {
    const a = attention(model({ totals: { users: 391, optedOut: 26, withAnyAsset: 100 } }));
    expect(a.some((x) => x.text.includes("saved nothing"))).toBe(true);
  });
});

describe("subjectLine", () => {
  it("puts the two numbers worth seeing on a phone in the subject", () => {
    expect(subjectLine(model())).toBe("2026-09-05 · 5 signups · 40 visitors");
  });

  it("promotes leads and appends unsubscribes when they exist", () => {
    const s = subjectLine(
      model({ today: counts({ unsubscribes: 2 }), leads: [{ createdAt: "x", kind: "k", who: "w" }] })
    );
    expect(s).toBe("2026-09-05 · 1 lead · 5 signups · 40 visitors · 2 unsub");
  });

  it("singularises correctly", () => {
    expect(subjectLine(model({ today: counts({ signups: 1 }) }))).toContain("1 signup ·");
  });
});

describe("rate helpers", () => {
  it("pct returns 0 rather than NaN or Infinity on a zero denominator", () => {
    expect(pct(5, 0)).toBe(0);
    expect(pct(0, 0)).toBe(0);
    expect(round1(pct(10, 36))).toBe(27.8);
  });
});
