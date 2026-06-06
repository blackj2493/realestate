import { describe, it, expect } from "vitest";
import { bedsLabel } from "./bedsLabel";

describe("bedsLabel", () => {
  it("renders the 4+1 split when there are below-grade bedrooms", () => {
    expect(bedsLabel({ BedroomsAboveGrade: 4, BedroomsBelowGrade: 1 })).toBe("4+1");
  });

  it("renders just the above-grade count when there are no below-grade bedrooms", () => {
    expect(bedsLabel({ BedroomsAboveGrade: 4, BedroomsBelowGrade: 0 })).toBe("4");
    expect(bedsLabel({ BedroomsAboveGrade: 3 })).toBe("3");
  });

  it("falls back to BedroomsTotal when above-grade is missing", () => {
    expect(bedsLabel({ BedroomsTotal: 5 })).toBe("5");
  });

  it("treats an above-grade value of 0 as missing and falls back to the total", () => {
    // TRREB sometimes stores BedroomsAboveGrade as 0 while the total carries 4+1=5.
    expect(bedsLabel({ BedroomsAboveGrade: 0, BedroomsTotal: 5, BedroomsBelowGrade: 1 })).toBe("5+1");
  });

  it("returns null when there is no bedroom data at all", () => {
    expect(bedsLabel({})).toBeNull();
    expect(bedsLabel({ BedroomsAboveGrade: 0, BedroomsBelowGrade: 0 })).toBeNull();
  });
});
