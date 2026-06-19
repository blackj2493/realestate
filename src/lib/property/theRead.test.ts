import { describe, it, expect } from "vitest";
import { buildTheRead } from "./theRead";
import type { ListingDetail } from "./getListingDetail";

const base = (over: Partial<ListingDetail> = {}): ListingDetail =>
  ({
    full_payload: {
      ListPrice: 899000,
      OriginalListPrice: 929000,
      KitchensBelowGrade: 1,
      LotWidth: 33,
      DaysOnMarket: 11,
      PropertySubType: "Semi-Detached House",
    },
    estimate: { estimatedValue: 862000, confidence: "HIGH" },
    expectedSale: { expectedPrice: 868000, ratio: 0.965 },
    dealScore: {
      score: 71,
      grade: "B",
      verdict: "",
      components: [
        {
          key: "value",
          label: "Value vs Comps",
          points: 30,
          weight: 35,
          direction: "down",
          detail: "Listed 4.3% above comparable sales (high confidence)",
        },
      ],
    },
    valueAdd: null,
    campaignHistory: {
      available: true,
      campaignCount: 2,
      trueDom: 38,
      totalPriceDrop: 30000,
      firstSeenDate: null,
      events: [],
    },
    priceTimeline: { currentPrice: 899000, originalPrice: 929000, totalPriceDrop: 30000, trueDom: 38 },
    capRatePct: 3.9,
    ...over,
  }) as unknown as ListingDetail;

describe("buildTheRead", () => {
  it("is deterministic", () => {
    expect(buildTheRead(base())).toEqual(buildTheRead(base()));
  });

  it("full tier surfaces the relist + over-AVM catch and an expected-sale price read", () => {
    const r = buildTheRead(base());
    expect(r.tier).toBe("full");
    expect(r.catch_).toMatch(/relisted 2×/i);
    expect(r.catch_).toMatch(/above comparable sales/i);
    expect(r.priceRead).toMatch(/closes near \$868K/);
    // The Read must NOT surface a competing dollar AVM "estimate" anymore.
    expect(r.priceRead).not.toMatch(/our \$[\d,]+ estimate/i);
    expect(r.grade).toBe("B");
  });

  it("anon (gated) drops to lite and nudges sign-in", () => {
    const r = buildTheRead(
      base({
        estimate: null,
        capRatePct: null,
        dealScore: { score: null, grade: null, verdict: "", components: [] },
        priceTimeline: { currentPrice: 899000, originalPrice: null, totalPriceDrop: 0, trueDom: null },
      } as unknown as Partial<ListingDetail>),
    );
    expect(r.tier).toBe("lite");
    expect(r.priceRead).toMatch(/Down \$30K from the original \$929K ask/);
    expect(r.thesisByPersona.cashflow).toMatch(/Sign in/);
  });

  it("folds Things-to-Know warn flags into the catch, ranked by severity", () => {
    const r = buildTheRead(base(), [
      { id: "flood", kind: "warn", severity: 70, title: "In a flood screening zone", source: "TRCA" },
      { id: "suite", kind: "info", severity: 26, title: "Basement-suite potential", source: "feed" },
    ]);
    expect(r.catch_).toMatch(/in a flood screening zone/i);
    // info-kind flags never become a "catch"
    expect(r.catch_).not.toMatch(/basement-suite/i);
  });
});
