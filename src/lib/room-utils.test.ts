import { describe, expect, it } from "vitest";
import { formatDimensions, formatFeetInches } from "./room-utils";

describe("formatFeetInches", () => {
  it("rounds to the nearest inch", () => {
    expect(formatFeetInches(3.5)).toBe(`11'6"`);
    expect(formatFeetInches(3.05)).toBe(`10'0"`);
    expect(formatFeetInches(4.2)).toBe(`13'9"`);
  });

  it("carries 12 inches into the next foot", () => {
    expect(formatFeetInches(3.9624)).toBe(`13'0"`); // 155.99 in
  });
});

describe("formatDimensions", () => {
  it("keeps metres by default", () => {
    expect(formatDimensions(3.5, 4.2)).toBe("3.50m × 4.20m");
  });

  it("switches to feet and inches with the imperial unit", () => {
    expect(formatDimensions(3.5, 4.2, "sqft")).toBe(`11'6" × 13'9"`);
  });

  it("says N/A without both numbers", () => {
    expect(formatDimensions(undefined, 4.2, "sqft")).toBe("N/A");
  });
});
