import { describe, expect, it } from "vitest";
import {
  applySignupFilter,
  cleanSignupFilter,
  isDefaultLens,
  SIGNUP_BED_CHOICES,
} from "./signupFilter";
import { DEFAULT_ACTIVITY_LENS, hasActiveLensFilters, type MarketActivityLens } from "./config";

/**
 * The invariant that matters most: a signup answer must make hasActiveLensFilters TRUE.
 * `alert_scope = 'filtered'` over a lens that narrows nothing emits no clauses and delivers
 * the whole city — which is what 196 of 397 production alert rows do.
 */
describe("cleanSignupFilter", () => {
  it("accepts a home type and turns the lens into a real filter", () => {
    const f = cleanSignupFilter({ propertyTypes: ["detached"], minBeds: 0 });
    expect(f).toEqual({ propertyTypes: ["detached"], minBeds: 0 });
    expect(hasActiveLensFilters(applySignupFilter(DEFAULT_ACTIVITY_LENS, f!))).toBe(true);
  });

  it("accepts bedrooms alone", () => {
    const f = cleanSignupFilter({ propertyTypes: [], minBeds: 3 });
    expect(f).toEqual({ propertyTypes: [], minBeds: 3 });
    expect(hasActiveLensFilters(applySignupFilter(DEFAULT_ACTIVITY_LENS, f!))).toBe(true);
  });

  describe("null means 'behave exactly as signup did before this question existed'", () => {
    it("for a skipped answer", () => {
      expect(cleanSignupFilter({ propertyTypes: [], minBeds: 0 })).toBeNull();
    });
    it("for a missing field", () => {
      expect(cleanSignupFilter({})).toBeNull();
    });
    it("for a pre-deploy client that sends nothing at all", () => {
      expect(cleanSignupFilter(undefined)).toBeNull();
      expect(cleanSignupFilter(null)).toBeNull();
    });
    it("for junk", () => {
      expect(cleanSignupFilter("detached")).toBeNull();
      expect(cleanSignupFilter(7)).toBeNull();
      expect(cleanSignupFilter({ propertyTypes: "detached", minBeds: "three" })).toBeNull();
    });
  });

  it("drops unknown type keys rather than rejecting the whole answer", () => {
    // The option list is data that changes. A stale client sending a retired key should
    // still get the filter it can express — a 400 here would fail a Terms acceptance.
    expect(cleanSignupFilter({ propertyTypes: ["detached", "castle"], minBeds: 0 })).toEqual({
      propertyTypes: ["detached"],
      minBeds: 0,
    });
    // …and an answer that was ONLY junk is the same as no answer.
    expect(cleanSignupFilter({ propertyTypes: ["castle"], minBeds: 0 })).toBeNull();
  });

  it("de-duplicates repeated keys", () => {
    expect(cleanSignupFilter({ propertyTypes: ["condo", "condo"], minBeds: 0 })?.propertyTypes).toEqual(["condo"]);
  });

  it("bounds bedrooms to what the chips can offer", () => {
    const max = SIGNUP_BED_CHOICES[SIGNUP_BED_CHOICES.length - 1];
    expect(cleanSignupFilter({ minBeds: 99 })?.minBeds).toBe(max);
    expect(cleanSignupFilter({ minBeds: -3 })).toBeNull(); // clamps to 0 → nothing to enforce
    expect(cleanSignupFilter({ minBeds: 2.7 })?.minBeds).toBe(2);
  });
});

describe("applySignupFilter", () => {
  it("touches only the two fields the question asked about", () => {
    const lens: MarketActivityLens = {
      ...DEFAULT_ACTIVITY_LENS,
      windowDays: 30,
      transactionType: "lease",
      minBaths: 2,
      basement: "finished",
      minFrontage: 40,
    };
    const next = applySignupFilter(lens, { propertyTypes: ["town"], minBeds: 2 });
    expect(next.propertyTypes).toEqual(["town"]);
    expect(next.minBeds).toBe(2);
    // Everything else survives untouched.
    expect(next.windowDays).toBe(30);
    expect(next.transactionType).toBe("lease");
    expect(next.minBaths).toBe(2);
    expect(next.basement).toBe("finished");
    expect(next.minFrontage).toBe(40);
  });

  it("stores beds as a minimum, because the chip reads '3+'", () => {
    const next = applySignupFilter({ ...DEFAULT_ACTIVITY_LENS, bedsExact: true }, {
      propertyTypes: [],
      minBeds: 3,
    });
    expect(next.bedsExact).toBe(false);
  });
});

describe("isDefaultLens", () => {
  it("is true for the untouched default", () => {
    expect(isDefaultLens(DEFAULT_ACTIVITY_LENS)).toBe(true);
    // A fresh object with the same values, not the same reference.
    expect(isDefaultLens({ ...DEFAULT_ACTIVITY_LENS, propertyTypes: [] })).toBe(true);
  });

  it("is false once any field has been set", () => {
    const changed: Array<Partial<MarketActivityLens>> = [
      { propertyTypes: ["detached"] },
      { minBeds: 1 },
      { minBaths: 1 },
      { minGarage: 1 },
      { basement: "finished" },
      { minFrontage: 20 },
      { transactionType: "lease" },
      { windowDays: 30 },
      { bedsExact: true },
    ];
    for (const over of changed) {
      expect(isDefaultLens({ ...DEFAULT_ACTIVITY_LENS, ...over }), JSON.stringify(over)).toBe(false);
    }
  });
});
