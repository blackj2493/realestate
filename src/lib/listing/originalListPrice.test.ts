import { describe, it, expect } from "vitest";
import {
  sanitizeOriginalListPrice,
  isOriginalListPriceCorrupt,
  ORIGINAL_LIST_MAX_RATIO,
} from "./originalListPrice";

describe("sanitizeOriginalListPrice", () => {
  it("keeps a genuine price reduction", () => {
    expect(sanitizeOriginalListPrice(949_000, 899_000)).toBe(949_000); // 1.06x
    expect(sanitizeOriginalListPrice(1_399_000, 1_249_888)).toBe(1_399_000); // 1.12x
    expect(sanitizeOriginalListPrice(2_000_000, 1_000_000)).toBe(2_000_000); // 2x, steep but real
  });

  it("keeps an unchanged ask", () => {
    expect(sanitizeOriginalListPrice(688_000, 688_000)).toBe(688_000);
  });

  it("rejects the 1000x feed scale error", () => {
    // The real rows that prompted this: 6 Oaken Gate Way and friends.
    expect(sanitizeOriginalListPrice(949_000_000, 949_000)).toBeNull();
    expect(sanitizeOriginalListPrice(2_995_000_000, 2_995_000)).toBeNull();
    expect(sanitizeOriginalListPrice(1_399_000_000, 1_249_888)).toBeNull(); // 1119x
  });

  it("rejects a lease rent scaled into the sale field", () => {
    // $5,500/mo -> $5,500,000. An absolute dollar ceiling would have let this through.
    expect(sanitizeOriginalListPrice(5_500_000, 5_500)).toBeNull();
    expect(sanitizeOriginalListPrice(16_499_000, 16_499)).toBeNull();
  });

  it("rejects the inverse corruption — an original far below the live ask", () => {
    expect(sanitizeOriginalListPrice(9_000, 900_000)).toBeNull();
  });

  it("returns null when either side is missing or nonsense", () => {
    expect(sanitizeOriginalListPrice(null, 688_000)).toBeNull();
    expect(sanitizeOriginalListPrice(688_000, null)).toBeNull();
    expect(sanitizeOriginalListPrice(undefined, undefined)).toBeNull();
    expect(sanitizeOriginalListPrice(0, 688_000)).toBeNull();
    expect(sanitizeOriginalListPrice(688_000, 0)).toBeNull();
    expect(sanitizeOriginalListPrice(NaN, 688_000)).toBeNull();
  });

  it("holds the boundary exactly at the ratio cap", () => {
    const list = 100_000;
    expect(sanitizeOriginalListPrice(list * ORIGINAL_LIST_MAX_RATIO, list)).toBe(500_000);
    expect(sanitizeOriginalListPrice(list * ORIGINAL_LIST_MAX_RATIO + 1, list)).toBeNull();
  });

  it("isOriginalListPriceCorrupt flags only the scale errors, not missing data", () => {
    expect(isOriginalListPriceCorrupt(949_000_000, 949_000)).toBe(true);
    expect(isOriginalListPriceCorrupt(949_000, 899_000)).toBe(false);
    // Absent data is not corruption — it is just absent.
    expect(isOriginalListPriceCorrupt(null, 899_000)).toBe(false);
    expect(isOriginalListPriceCorrupt(949_000, null)).toBe(false);
  });
});
