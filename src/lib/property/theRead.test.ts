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
    saleHistory: { available: false, saleCount: 0, events: [], lastClosePrice: null, lastCloseDate: null },
    feeStability: { available: false, trend: null },
    synced_at: "2026-07-01T12:00:00Z",
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

  it("anchors the price read on the prior sale, annualized for multi-year holds", () => {
    const r = buildTheRead(
      base({
        saleHistory: {
          available: true,
          saleCount: 1,
          events: [],
          lastClosePrice: 700000,
          lastCloseDate: "2019-06-15",
        },
      } as unknown as Partial<ListingDetail>),
    );
    // 700K → 899K over ~7.04 yrs ⇒ +3.6%/yr
    expect(r.priceRead).toMatch(/Last traded at \$700K in 2019 — ask implies \+3\.6%\/yr since\./);
  });

  it("uses total change (not annualized) for sub-year holds", () => {
    const r = buildTheRead(
      base({
        saleHistory: {
          available: true,
          saleCount: 1,
          events: [],
          lastClosePrice: 850000,
          lastCloseDate: "2026-01-01",
        },
      } as unknown as Partial<ListingDetail>),
    );
    expect(r.priceRead).toMatch(/Last traded at \$850K in 2026 — ask is \+5\.8% on that sale\./);
  });

  it("omits the prior-sale line when sale history is gated (anon nulls)", () => {
    expect(buildTheRead(base()).priceRead).not.toMatch(/Last traded/);
  });

  it("folds condo fee position and trend into the catch ledger", () => {
    const r = buildTheRead(
      base({
        capRatePct: null, // keep the thin-cap neg out so both fee items rank into the top 3
        feeStability: {
          available: true,
          unitFeePsf: 0.95,
          area: {
            cityRegion: "Toronto C01",
            medianPsf: 0.78,
            p25Psf: 0.65,
            p75Psf: 0.88,
            position: "above",
            pctVsMedian: 19.25,
            sampleCount: 120,
            inclusionsMixed: false,
          },
          trend: {
            band: "Rising",
            annualPct: 9.6,
            buckets: [],
            confidence: "HIGH",
            sampleCount: 40,
          },
        },
      } as unknown as Partial<ListingDetail>),
    );
    expect(r.catch_).toMatch(/building fees rising ~9\.6%\/yr \(rising trend\)/);
    expect(r.catch_).toMatch(/maintenance fees run 19% above the area median/);
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

  it("derives evidence links for exactly the clauses that made the cut", () => {
    const r = buildTheRead(base(), [
      { id: "flood", kind: "warn", severity: 70, title: "In a flood screening zone", source: "TRCA" },
    ]);
    // Catch = flood flag (70), relist (58), thin cap (44) → things-to-know, history, sandbox.
    expect(r.links.catch_.map((l) => l.target)).toEqual([
      '[data-tour="listing-things-to-know"]',
      "#history",
      '[data-tour="listing-underwriting"]',
    ]);
    // Suite in the fixture → smart thesis points at the sandbox.
    expect(r.links.thesisByPersona.smart[0].target).toBe('[data-tour="listing-underwriting"]');
    // Full tier with a price cut → estimate + history.
    expect(r.links.price.map((l) => l.target)).toEqual(["#financials", "#history"]);
  });

  it("dedupes catch links by target and emits no price links in lite", () => {
    const r = buildTheRead(
      base({
        estimate: null,
        capRatePct: null,
        dealScore: { score: null, grade: null, verdict: "", components: [] },
        priceTimeline: { currentPrice: 899000, originalPrice: null, totalPriceDrop: 0, trueDom: null },
      } as unknown as Partial<ListingDetail>),
      [
        { id: "flood", kind: "warn", severity: 70, title: "Flood zone", source: "TRCA" },
        { id: "rail", kind: "warn", severity: 40, title: "120 m from a rail corridor", source: "ORWN" },
      ],
    );
    // Both catch clauses come from Things to Know → one deduped link.
    expect(r.links.catch_).toHaveLength(1);
    expect(r.links.catch_[0].target).toBe('[data-tour="listing-things-to-know"]');
    expect(r.links.price).toEqual([]);
  });
});
