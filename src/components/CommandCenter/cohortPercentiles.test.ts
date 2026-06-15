import { describe, it, expect } from "vitest";
import { makeCohortRanker, MIN_COHORT } from "./cohortPercentiles";
import type { ListingDocument } from "@/lib/typesense/client";

/** Minimal doc carrying just the cap-rate field the ranker reads. */
function doc(cap: number): ListingDocument {
  return { id: String(cap), ListPrice: 500_000, cap_rate_est: cap } as ListingDocument;
}

describe("makeCohortRanker", () => {
  it("returns null when the cohort is below MIN_COHORT", () => {
    const listings = Array.from({ length: MIN_COHORT - 1 }, (_, i) => doc(2 + i));
    const rank = makeCohortRanker(listings);
    expect(rank("capRate", 5)).toBeNull();
  });

  it("ranks a value by the % of the cohort below it", () => {
    const listings = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(doc); // 12 in-band values
    const rank = makeCohortRanker(listings);
    expect(rank("capRate", 1)).toBe(0); // nothing below the min
    expect(rank("capRate", 7)).toBe(50); // 6 of 12 below
    expect(rank("capRate", 12)).toBe(92); // 11 of 12 below → round(91.67)
  });

  it("excludes out-of-band and missing values from the cohort", () => {
    const listings = [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(doc), // 10 valid
      doc(0), // below the cap-rate sanity band → excluded
      doc(99), // above the band → excluded
      { id: "x", ListPrice: 1 } as ListingDocument, // no cap_rate_est → excluded
    ];
    const rank = makeCohortRanker(listings);
    expect(rank("capRate", 5)).toBe(40); // cohort is [1..10]; 4 below 5
  });

  it("returns null for a non-finite value", () => {
    const rank = makeCohortRanker([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(doc));
    expect(rank("capRate", Number.NaN)).toBeNull();
  });
});
