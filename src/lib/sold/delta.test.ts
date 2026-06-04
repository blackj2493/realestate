import { describe, it, expect } from "vitest";
import { soldVsAsk } from "./delta";

describe("soldVsAsk", () => {
  it("returns null when ask is missing or non-positive", () => {
    expect(soldVsAsk(900000, null)).toBeNull();
    expect(soldVsAsk(900000, 0)).toBeNull();
    expect(soldVsAsk(900000, undefined)).toBeNull();
  });

  it("computes an over-ask sale", () => {
    expect(soldVsAsk(1_100_000, 1_000_000)).toEqual({ deltaAbs: 100_000, deltaPct: 10, direction: "over" });
  });

  it("computes an under-ask sale", () => {
    expect(soldVsAsk(950_000, 1_000_000)).toEqual({ deltaAbs: -50_000, deltaPct: -5, direction: "under" });
  });

  it("computes an at-ask sale", () => {
    expect(soldVsAsk(1_000_000, 1_000_000)).toEqual({ deltaAbs: 0, deltaPct: 0, direction: "at" });
  });

  it("rounds the percentage to one decimal", () => {
    expect(soldVsAsk(1_033_300, 1_000_000)?.deltaPct).toBe(3.3);
  });
});
