import { describe, expect, it } from "vitest";
import { titleYear } from "./titleYear";

describe("titleYear", () => {
  it("uses Toronto time, so New Year's Eve in Toronto is still the old year", () => {
    // 2027-01-01 03:00 UTC = 2026-12-31 22:00 in Toronto.
    expect(titleYear(new Date("2027-01-01T03:00:00Z"))).toBe(2026);
    expect(titleYear(new Date("2027-01-01T06:00:00Z"))).toBe(2027);
  });
});
