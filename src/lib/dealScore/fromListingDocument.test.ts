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

/**
 * The 118 Village Gate regression: called with no scoring inputs, this path omitted the
 * PRICE pillar and `blendForPersona` renormalized its weight onto TERMS. For the Homebuyer
 * lens (price 0.55 / terms 0.45, yield+upside 0) that leaves TERMS carrying 100%, so the
 * headline became a pure price-cut-and-DOM score: A+ 95 in the ledger, 38 D on the page,
 * and a "≥ A" filter that surfaced it.
 */
describe("missing PRICE pillar — withhold, never renormalize", () => {
  // Strong TERMS signal (a 6% cut, aging listing) and nothing else. Pre-fix this scored
  // near the top on the Homebuyer lens purely because PRICE was absent.
  const strongTerms = baseDoc({ ListPrice: 800000, OriginalListPrice: 850000, DaysOnMarket: 90 });

  it("withholds the Homebuyer grade when there is no AVM input", () => {
    const r = dealScoreFromDocument(strongTerms, null, "smart");
    expect(r.score, "a terms-only headline is not a Homebuyer deal grade").toBeNull();
    expect(r.grade).toBeNull();
  });

  it("still scores the Homebuyer lens once the AVM input is supplied", () => {
    const r = dealScoreFromDocument(
      strongTerms,
      { estimatedValue: 900000, confidence: "HIGH", expectedSalePrice: 780000, closeListRatio: 0.975 },
      "smart"
    );
    expect(r.score).not.toBeNull();
    expect(r.components.some((c) => c.key === "price")).toBe(true);
  });

  it("does NOT withhold for lenses where PRICE is not dominant", () => {
    // cashflow weights price 0.25 against yield 0.55 — the remaining signals still say
    // something real, so blanking the grade there would over-correct.
    const withCap = baseDoc({ cap_rate_est: 6 });
    expect(dealScoreFromDocument(withCap, null, "cashflow").score).not.toBeNull();
    expect(dealScoreFromDocument(withCap, null, "builders").score).not.toBeNull();
  });

  it("treats a zero/!valid estimate as absent rather than as a real value", () => {
    expect(dealScoreFromDocument(strongTerms, { estimatedValue: 0, confidence: "HIGH" }, "smart").score).toBeNull();
    expect(
      dealScoreFromDocument(strongTerms, { estimatedValue: null, confidence: null, expectedSalePrice: null, closeListRatio: null }, "smart").score
    ).toBeNull();
  });

  it("an overpriced listing with great terms grades WORSE than an underpriced one", () => {
    // The actual shape of the bug: identical TERMS, opposite price-vs-value.
    const over = dealScoreFromDocument(
      strongTerms,
      { estimatedValue: 700000, confidence: "HIGH", expectedSalePrice: 780000, closeListRatio: 0.975 },
      "smart"
    );
    const under = dealScoreFromDocument(
      strongTerms,
      { estimatedValue: 950000, confidence: "HIGH", expectedSalePrice: 780000, closeListRatio: 0.975 },
      "smart"
    );
    expect(over.score!).toBeLessThan(under.score!);
  });
});
