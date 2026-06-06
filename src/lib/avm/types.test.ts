import { describe, it, expect } from "vitest";
import { MIN_SALE_PRICE } from "./types";

describe("MIN_SALE_PRICE", () => {
  it("excludes residential leases but keeps low-end sales", () => {
    expect(3250).toBeLessThan(MIN_SALE_PRICE);
    expect(120000).toBeGreaterThanOrEqual(MIN_SALE_PRICE);
  });
});
