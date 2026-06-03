import { describe, it, expect } from "vitest";
import { SOLD_DISPLAY_MAX_DAYS, SOLD_WINDOW_OPTIONS, clampWindowDays } from "./config";

describe("sold config", () => {
  it("defaults the cap to 180 days", () => {
    expect(SOLD_DISPLAY_MAX_DAYS).toBe(180);
  });

  it("only offers window options within the cap", () => {
    expect(SOLD_WINDOW_OPTIONS.every((d) => d <= SOLD_DISPLAY_MAX_DAYS)).toBe(true);
    expect(SOLD_WINDOW_OPTIONS).toContain(90);
    expect(SOLD_WINDOW_OPTIONS).toContain(180);
  });

  it("clamps a requested window to [1, cap]", () => {
    expect(clampWindowDays(9999)).toBe(SOLD_DISPLAY_MAX_DAYS);
    expect(clampWindowDays(0)).toBe(1);
    expect(clampWindowDays(-5)).toBe(1);
    expect(clampWindowDays(90)).toBe(90);
    expect(clampWindowDays(Number.NaN)).toBe(SOLD_DISPLAY_MAX_DAYS);
  });
});
