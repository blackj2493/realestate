import { describe, expect, it } from "vitest";
import { buildQuickFacts, typeWords, type QuickFactsListing } from "./quickFacts";
import type { CommunityFactsRow } from "@/lib/data/communityFacts";

const listing: QuickFactsListing = {
  listPrice: 1_149_000,
  originalListPrice: 1_149_000,
  daysOnMarket: 18,
  beds: "3",
  subType: "Semi-Detached",
  hood: "Wismer",
  city: "Markham",
};

const row: CommunityFactsRow = {
  city: "Markham",
  city_region: "Wismer",
  sales_12m: 142,
  median_price: 1_215_000,
  gap_sample: 120,
  under_ask_share: 0.62,
  ask_gap_median: -2.4,
  dom_sample: 130,
  median_dom: 16,
  active_count: 40,
  cut_share: 0.31,
  median_cut_pct: 4.2,
  median_true_dom: 22,
  computed_at: "2026-11-08T08:00:00Z",
};

describe("buildQuickFacts", () => {
  it("writes the listing sentences and three answers", () => {
    const f = buildQuickFacts(listing, row)!;
    expect(f.summary).toBe(
      "This 3-bedroom semi-detached home in Wismer, Markham is listed for $1,149,000. It came on the market 18 days ago. " +
        "The asking price has not changed.",
    );
    expect(f.faqs.map((q) => q.q)).toEqual([
      "How does the asking price compare with Wismer?",
      "How fast do homes sell in Wismer?",
      "Do homes in Wismer sell over asking?",
    ]);
    expect(f.faqs[0].a).toContain("5% below the median sale price");
    expect(f.faqs[0].a).toContain("not a value for this home");
    expect(f.faqs[1].a).toContain("31% have cut their asking price");
    expect(f.faqs[2].a).toContain("62% of homes in Wismer, Markham sold for less than their first asking price");
    expect(f.updatedLabel).toBe("November 8, 2026");
  });

  it("states a price cut", () => {
    const f = buildQuickFacts({ ...listing, originalListPrice: 1_199_000 }, null)!;
    expect(f.summary).toContain("The asking price was cut from $1,199,000 to $1,149,000 (4.2% lower).");
    expect(f.faqs).toEqual([]);
    expect(f.updatedLabel).toBeNull();
  });

  it("drops neighbourhood facts with a thin sample", () => {
    const f = buildQuickFacts(listing, { ...row, sales_12m: 12, gap_sample: 10, dom_sample: 10, active_count: 5 })!;
    expect(f.faqs).toEqual([]);
    expect(f.updatedLabel).toBeNull();
  });

  it("returns null without a price", () => {
    expect(buildQuickFacts({ ...listing, listPrice: 0 }, row)).toBeNull();
  });

  it("uses the city alone when there is no community", () => {
    const f = buildQuickFacts({ ...listing, hood: null, beds: null, daysOnMarket: 0 }, null)!;
    expect(f.summary.startsWith("This semi-detached home in Markham is listed for $1,149,000. It came on the market today.")).toBe(true);
  });
});

describe("typeWords", () => {
  it("maps feed sub-types", () => {
    expect(typeWords("Att/Row/Townhouse")).toBe("townhouse");
    expect(typeWords("Condo Apartment")).toBe("condo apartment");
    expect(typeWords("Detached")).toBe("detached home");
    expect(typeWords("Vacant Land")).toBe("home");
    expect(typeWords(null)).toBe("home");
  });
});
