import { describe, it, expect } from "vitest";
import {
  sanitizeRatePct,
  resolveStreetRate,
  daysSince,
  isRateStale,
  parseValetLatest,
  MORTGAGE_RATE_BOUNDS,
} from "./mortgageRates";

describe("sanitizeRatePct", () => {
  it("accepts finite rates inside the sanity band", () => {
    expect(sanitizeRatePct(5.5)).toBe(5.5);
    expect(sanitizeRatePct(MORTGAGE_RATE_BOUNDS.minPct)).toBe(1);
    expect(sanitizeRatePct(MORTGAGE_RATE_BOUNDS.maxPct)).toBe(15);
    expect(sanitizeRatePct(5.2946)).toBe(5.295); // rounded to 3dp
  });

  it("rejects out-of-band and non-finite values (returns null, never a bad rate)", () => {
    expect(sanitizeRatePct(0.9)).toBeNull(); // below floor — a decimal-vs-percent slip
    expect(sanitizeRatePct(15.5)).toBeNull(); // above ceiling
    expect(sanitizeRatePct(0)).toBeNull();
    expect(sanitizeRatePct(NaN)).toBeNull();
    expect(sanitizeRatePct(Infinity)).toBeNull();
  });
});

describe("resolveStreetRate", () => {
  it("subtracts the posted→street discount", () => {
    expect(resolveStreetRate(6.79, 1.5)).toBeCloseTo(5.29, 5);
  });
  it("floors at zero (a later sanitize call rejects it)", () => {
    expect(resolveStreetRate(1.0, 1.5)).toBe(0);
    expect(sanitizeRatePct(resolveStreetRate(1.0, 1.5))).toBeNull();
  });
});

describe("daysSince / isRateStale", () => {
  const now = new Date("2026-07-20T00:00:00Z");
  it("counts whole days", () => {
    expect(daysSince("2026-07-10", now)).toBe(10);
    expect(daysSince("2026-07-20", now)).toBe(0);
  });
  it("treats unparseable dates as null", () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("not-a-date", now)).toBeNull();
  });
  it("flags stale past the window, and treats missing dates as stale", () => {
    expect(isRateStale("2026-05-01", 45, now)).toBe(true); // 80 days
    expect(isRateStale("2026-07-10", 45, now)).toBe(false); // 10 days
    expect(isRateStale(null, 45, now)).toBe(true);
  });
});

describe("parseValetLatest", () => {
  const payload = {
    observations: [
      { d: "2026-06-24", V80691335: { v: "5.84" } },
      { d: "2026-07-15", V80691335: { v: "5.79" } },
    ],
  };
  it("pulls the most recent observation for the series", () => {
    expect(parseValetLatest(payload, "V80691335")).toEqual({ valuePct: 5.79, date: "2026-07-15" });
  });
  it("returns null for empty / missing / malformed payloads", () => {
    expect(parseValetLatest({ observations: [] }, "V80691335")).toBeNull();
    expect(parseValetLatest({}, "V80691335")).toBeNull();
    expect(parseValetLatest(null, "V80691335")).toBeNull();
    expect(parseValetLatest(payload, "V_MISSING")).toBeNull();
  });
});
