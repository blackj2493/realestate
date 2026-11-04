import { describe, expect, it } from "vitest";
import { hstRelief, reliefBand } from "./newHomeRelief";

describe("hstRelief", () => {
  it("gives the full 13% up to $1M", () => {
    expect(hstRelief(500_000)).toBe(65_000);
    expect(hstRelief(1_000_000)).toBe(130_000);
  });
  it("is flat $130,000 from $1M to $1.5M", () => {
    expect(hstRelief(1_200_000)).toBe(130_000);
    expect(hstRelief(1_500_000)).toBe(130_000);
  });
  it("falls in a straight line from $1.5M to $1.85M", () => {
    expect(hstRelief(1_675_000)).toBe(77_000);
    expect(hstRelief(1_849_999)).toBeGreaterThanOrEqual(24_000);
  });
  it("is the old $24,000 rebate from $1.85M", () => {
    expect(hstRelief(1_850_000)).toBe(24_000);
    expect(hstRelief(3_000_000)).toBe(24_000);
  });
  it("returns 0 for no price", () => {
    expect(hstRelief(0)).toBe(0);
    expect(hstRelief(Number.NaN)).toBe(0);
  });
  it("names the band", () => {
    expect(reliefBand(999_999)).toBe("under_1m");
    expect(reliefBand(1_400_000)).toBe("1m_1_5m");
    expect(reliefBand(1_600_000)).toBe("1_5m_1_85m");
    expect(reliefBand(2_000_000)).toBe("over_1_85m");
  });
});
