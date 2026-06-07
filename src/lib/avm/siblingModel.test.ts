import { describe, it, expect } from "vitest";
import { pickSibling } from "./siblingModel";

describe("pickSibling", () => {
  it("picks the most-sales cohort above the R²/n gate", () => {
    const r = pickSibling([
      { city_region: "Aurora Highlands", model_accuracy_score: 0.62, total_sales_analyzed: 180 },
      { city_region: "Aurora Village", model_accuracy_score: 0.71, total_sales_analyzed: 90 },
    ]);
    expect(r?.city_region).toBe("Aurora Highlands");
  });
  it("rejects cohorts below the gate", () => {
    expect(pickSibling([{ city_region: "Thin", model_accuracy_score: 0.4, total_sales_analyzed: 200 }])).toBeNull();
    expect(pickSibling([{ city_region: "Tiny", model_accuracy_score: 0.9, total_sales_analyzed: 12 }])).toBeNull();
  });
});
