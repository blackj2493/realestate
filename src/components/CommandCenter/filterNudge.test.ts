import { describe, it, expect } from "vitest";
import { formatResultNudge } from "./filterNudge";

describe("formatResultNudge", () => {
  it("shows a plain count when nothing is hidden by the cap", () => {
    expect(formatResultNudge(42, 42)).toEqual({ text: "42 matches", overflowing: false });
  });
  it("uses the singular for one match", () => {
    expect(formatResultNudge(1, 1)).toEqual({ text: "1 match", overflowing: false });
  });
  it("prompts to narrow when the total exceeds what is shown", () => {
    expect(formatResultNudge(100, 340)).toEqual({ text: "100 of 340 — narrow", overflowing: true });
  });
});
