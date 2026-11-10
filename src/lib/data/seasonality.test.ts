import { describe, expect, it } from "vitest";
import { salesByCalendarMonth } from "./seasonality";

const series = (from: [number, number], n: number, sales = 100) =>
  Array.from({ length: n }, (_, i) => {
    const t = from[0] * 12 + (from[1] - 1) + i;
    return { month: `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`, sales };
  });

describe("salesByCalendarMonth", () => {
  it("counts each calendar month exactly twice, ignoring the partial month and older months", () => {
    // Oct 2024 .. Nov 2026: 26 points. The window is Nov 2024 .. Oct 2026.
    const s = salesByCalendarMonth(series([2024, 10], 26), "2026-11-09T08:00:00Z")!;
    expect(s.from).toBe("2024-11");
    expect(s.to).toBe("2026-10");
    expect(s.months.every((m) => m.sales === 200)).toBe(true); // Oct counted twice, not three times
  });

  it("returns null when a month in the window is missing or below the floor", () => {
    expect(salesByCalendarMonth(series([2025, 1], 22), "2026-11-09T08:00:00Z")).toBeNull();
    expect(salesByCalendarMonth(series([2024, 11], 24, 10), "2026-11-09T08:00:00Z", 30)).toBeNull();
  });
});
