import { describe, it, expect } from "vitest";
import { compMonthlyRentFrom } from "./compRent";
import { seedMonthlyRent, rentSeedBasis } from "@/lib/underwriting/computeUnderwriting";

describe("compMonthlyRentFrom", () => {
  it("recovers the ladder's rent from the stored gross yield", () => {
    // X12909812 — 2bd Condo Townhouse, Barrhaven, $379,000, gross_yield_est 7.28%.
    // The ladder's `nbhd` rung said $2,300 and the page's own VOW lease grid agreed,
    // independently, across 91 signed leases within 2km.
    expect(compMonthlyRentFrom(7.28, 379_000)).toBe(2299);
  });

  it("refuses an out-of-band yield rather than inventing a rent", () => {
    // GROSS_YIELD_BAND is [1.5, 18]. Outside it the yield is noise, so the rent it
    // implies is noise too — the caller must fall back, not render a number.
    expect(compMonthlyRentFrom(0.4, 379_000)).toBeNull();
    expect(compMonthlyRentFrom(45, 379_000)).toBeNull();
  });

  it("returns null on absent or nonsensical inputs", () => {
    expect(compMonthlyRentFrom(null, 379_000)).toBeNull();
    expect(compMonthlyRentFrom(undefined, 379_000)).toBeNull();
    expect(compMonthlyRentFrom(7.28, 0)).toBeNull();
    expect(compMonthlyRentFrom(7.28, null)).toBeNull();
  });
});

describe("seedMonthlyRent — comps beat the price rule", () => {
  it("uses the comp when one exists", () => {
    expect(seedMonthlyRent(379_000, 2299)).toBe(2299);
    expect(rentSeedBasis(2299)).toBe("comps");
  });

  it("falls back to price x 0.004 only when there is no comp", () => {
    expect(seedMonthlyRent(379_000, null)).toBe(1516);
    expect(rentSeedBasis(null)).toBe("rule-of-thumb");
  });

  it("the fallback is why Gross Yield read 4.80% on EVERY listing", () => {
    // 0.004 x 12 = 4.8%. Any listing between the $375k and $3M clamp points printed the
    // same yield, because the tile was restating the constant, not measuring a market.
    for (const price of [400_000, 830_000, 1_250_000, 2_400_000]) {
      const rent = seedMonthlyRent(price, null);
      expect(((rent * 12) / price) * 100).toBeCloseTo(4.8, 1);
    }
  });

  it("ignores a zero or negative comp instead of seeding rent at 0", () => {
    expect(seedMonthlyRent(379_000, 0)).toBe(1516);
    expect(seedMonthlyRent(379_000, -50)).toBe(1516);
  });

  it("the comp is not clamped by the rule's floor — a real low rent survives", () => {
    // RENT_SEED_MIN exists to stop the price rule producing an absurd figure on a cheap
    // listing. A measured rent needs no such guard, and clamping one would overstate it.
    expect(seedMonthlyRent(150_000, 900)).toBe(900);
  });
});
