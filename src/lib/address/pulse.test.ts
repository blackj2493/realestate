import { describe, it, expect } from "vitest";
import { computePulse } from "./pulse";

describe("computePulse", () => {
  it("scores the 758 Cappamore reference pocket Warm / seller-leaning", () => {
    // Live numbers from the Nepean profile (2026-07-22): 40 actives, 4 new/wk,
    // 20% cut share, 8 sitting 30+, median 10 days listed.
    const p = computePulse({
      totalActives: 40,
      newThisWeek: 4,
      cutShare: 0.2,
      sitting30: 8,
      medianDaysListed: 10,
    });
    // 50 +15 (fast) +10 (fresh≥10%) −5 (cuts 15-30%) +0 (stale 20%) = 70
    expect(p.score).toBe(70);
    expect(p.label).toBe("Warm");
    expect(p.lean).toBe("seller-leaning");
    expect(p.blurb).toContain("4 fresh listings");
  });

  it("scores a stale, cut-heavy pocket Cold and never pegs below 5", () => {
    const p = computePulse({
      totalActives: 20,
      newThisWeek: 0,
      cutShare: 0.5,
      sitting30: 15,
      medianDaysListed: 80,
    });
    // 50 −10 −5 −15 −10 = 10
    expect(p.score).toBe(10);
    expect(p.label).toBe("Cold");
    expect(p.blurb).toContain("sat 80 days");
  });

  it("scores a fast low-cut pocket Hot and never pegs above 95", () => {
    const p = computePulse({
      totalActives: 30,
      newThisWeek: 6,
      cutShare: 0.03,
      sitting30: 2,
      medianDaysListed: 7,
    });
    // 50 +15 +10 +8 +8 = 91
    expect(p.score).toBe(91);
    expect(p.label).toBe("Hot");
    expect(p.lean).toBe("seller's market");
  });

  it("degrades gracefully with no inventory (no divide-by-zero, quiet blurb)", () => {
    const p = computePulse({
      totalActives: 0,
      newThisWeek: 0,
      cutShare: 0,
      sitting30: 0,
      medianDaysListed: null,
    });
    expect(p.score).toBeGreaterThanOrEqual(5);
    expect(p.score).toBeLessThanOrEqual(95);
    expect(p.blurb).toContain("quiet pocket");
  });
});
