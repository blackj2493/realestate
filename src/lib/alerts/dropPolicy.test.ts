import { describe, expect, it } from "vitest";
import { qualifiesAsDrop, MIN_DROP_ABS } from "./dropPolicy";

describe("qualifiesAsDrop", () => {
  it("ignores token cuts (the $1 reprice)", () => {
    expect(qualifiesAsDrop(1_200_000, 1_199_999)).toBe(false);
    expect(qualifiesAsDrop(1_200_000, 1_196_500)).toBe(false); // $3.5k, 0.29%
  });

  it("alerts on the absolute floor regardless of price tier", () => {
    expect(qualifiesAsDrop(2_000_000, 2_000_000 - MIN_DROP_ABS)).toBe(true); // 0.25% but $5k
  });

  it("alerts on the relative floor for cheaper homes", () => {
    expect(qualifiesAsDrop(450_000, 445_000)).toBe(true); // $5k = abs floor too
    expect(qualifiesAsDrop(400_000, 395_900)).toBe(true); // $4.1k ≥ 1%
    expect(qualifiesAsDrop(400_000, 396_500)).toBe(false); // $3.5k < 1% and < $5k
  });

  it("never fires on rises, equal prices, or garbage", () => {
    expect(qualifiesAsDrop(500_000, 500_000)).toBe(false);
    expect(qualifiesAsDrop(500_000, 510_000)).toBe(false);
    expect(qualifiesAsDrop(0, -5)).toBe(false);
    expect(qualifiesAsDrop(NaN, 100_000)).toBe(false);
  });
});
