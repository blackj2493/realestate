import { describe, it, expect } from "vitest";
import { BOARDS } from "./boards";

describe("cap_rate board uses the real field", () => {
  it("sorts/filters/labels off cap_rate_est, not ExtrapolatedCapRate", () => {
    const b = BOARDS.cap_rate;
    expect(b.sortBy).toBe("cap_rate_est");
    expect(b.metricField).toBe("cap_rate_est");
    expect(b.rawFilterBy).toContain("cap_rate_est");
    expect(b.rawFilterBy).not.toContain("ExtrapolatedCapRate");
  });
});
