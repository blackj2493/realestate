import { describe, it, expect } from "vitest";
import { dealScoreFromDocument } from "./fromListingDocument";
import type { ListingDocument } from "@/lib/typesense/client";

// Minimal doc with enough signal that the score is non-null even without yield.
const baseDoc = (over: Partial<ListingDocument> = {}): ListingDocument =>
  ({ ListPrice: 800000, OriginalListPrice: 850000, DaysOnMarket: 30, ...over } as ListingDocument);

// Score under the cashflow lens — the one that weights the Yield pillar (the homebuyer
// default lens excludes Yield by design), so this isolates the cap sanity-band gating.
const hasYield = (doc: ListingDocument) =>
  dealScoreFromDocument(doc, null, "cashflow").components.some((c) => c.key === "yield");

describe("dealScoreFromDocument cap input", () => {
  it("includes the yield component for an in-band real cap", () => {
    expect(hasYield(baseDoc({ cap_rate_est: 6 }))).toBe(true);
  });
  it("drops the yield component for an out-of-band real cap (no max-points clamp)", () => {
    expect(hasYield(baseDoc({ cap_rate_est: 16 }))).toBe(false);
    expect(hasYield(baseDoc({ cap_rate_est: 0 }))).toBe(false);
  });
  it("ignores the fake ExtrapolatedCapRate entirely", () => {
    // fake present, real absent → yield component must NOT appear
    expect(hasYield(baseDoc({ ExtrapolatedCapRate: 8 } as Partial<ListingDocument>))).toBe(false);
  });
  it("excludes Yield from the default (Homebuyer) lens even with a valid cap", () => {
    expect(dealScoreFromDocument(baseDoc({ cap_rate_est: 6 })).components.some((c) => c.key === "yield")).toBe(false);
  });
});
