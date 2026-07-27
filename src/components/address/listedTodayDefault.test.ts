import { describe, it, expect } from "vitest";
import { isCondoLike, dominantSubType, pickDefaultBandIndex } from "./listedTodayDefault";

describe("isCondoLike", () => {
  it("flags condo/co-op ownership forms", () => {
    for (const l of ["Condo Apartment", "Condo Townhouse", "Co-Op Apartment", "Vacant Land Condo"]) {
      expect(isCondoLike(l)).toBe(true);
    }
  });
  it("treats freehold houses as non-condo", () => {
    for (const l of ["Detached", "Semi-Detached", "Att/Row/Townhouse", "Link", "Duplex"]) {
      expect(isCondoLike(l)).toBe(false);
    }
  });
});

describe("dominantSubType", () => {
  it("returns the most frequent non-empty subtype", () => {
    expect(dominantSubType(["Detached", "Detached", "Semi-Detached"])).toBe("Detached");
  });
  it("ignores null/empty entries", () => {
    expect(dominantSubType([null, "", "  ", "Condo Apartment"])).toBe("Condo Apartment");
  });
  it("returns null when nothing usable is present", () => {
    expect(dominantSubType([null, "", undefined])).toBeNull();
  });
  it("resolves ties to the first-seen subtype", () => {
    expect(dominantSubType(["Detached", "Condo Apartment"])).toBe("Detached");
  });
});

describe("pickDefaultBandIndex", () => {
  it("picks the band matching the street's dominant type exactly", () => {
    expect(pickDefaultBandIndex(["Condo Apartment", "Detached"], "Detached")).toBe(1);
  });

  it("picks the same-family band when the exact type isn't a tab", () => {
    // Street is Semi-Detached; only Detached + Condo bands exist → the freehold one.
    expect(pickDefaultBandIndex(["Condo Apartment", "Detached"], "Semi-Detached")).toBe(1);
  });

  it("honors a condo hint over the non-condo default", () => {
    expect(pickDefaultBandIndex(["Detached", "Condo Apartment"], "Condo Apartment")).toBe(1);
  });

  it("defaults to the most common non-condo band when there is no hint", () => {
    // The reported bug: condo is the count-leader but the address is a house.
    expect(pickDefaultBandIndex(["Condo Apartment", "Detached"], null)).toBe(1);
  });

  it("keeps the count-leader when every nearby type is a condo", () => {
    expect(pickDefaultBandIndex(["Condo Apartment", "Condo Townhouse"], null)).toBe(0);
  });

  it("keeps index 0 when the hint has no family match and no non-condo band exists", () => {
    expect(pickDefaultBandIndex(["Condo Apartment", "Condo Townhouse"], "Detached")).toBe(0);
  });

  it("is safe for an empty band list", () => {
    expect(pickDefaultBandIndex([], "Detached")).toBe(0);
  });
});
