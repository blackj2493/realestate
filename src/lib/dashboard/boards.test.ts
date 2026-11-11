import { describe, it, expect } from "vitest";
import { BOARDS, MIN_REAL_SALE_PRICE } from "./boards";

describe("cap_rate board uses the real field", () => {
  it("sorts/filters/labels off cap_rate_est, not ExtrapolatedCapRate", () => {
    const b = BOARDS.cap_rate;
    expect(b.sortBy).toBe("cap_rate_est");
    expect(b.metricField).toBe("cap_rate_est");
    expect(b.rawFilterBy).toContain("cap_rate_est");
    expect(b.rawFilterBy).not.toContain("ExtrapolatedCapRate");
  });
});

describe("carry board skips placeholder prices", () => {
  it("filters out asks under MIN_REAL_SALE_PRICE", () => {
    expect(BOARDS.carry.rawFilterBy).toContain(`ListPrice:>=${MIN_REAL_SALE_PRICE}`);
    expect(MIN_REAL_SALE_PRICE).toBe(100000);
  });
});
