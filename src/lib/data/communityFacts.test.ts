import { describe, expect, it } from "vitest";
import { buildCommunityFacts, type CommunityFactsRow } from "./communityFacts";

const row = (over: Partial<CommunityFactsRow> = {}): CommunityFactsRow => ({
  city: "Markham",
  city_region: "Unionville",
  sales_12m: 412,
  median_price: 1388000,
  gap_sample: 405,
  under_ask_share: 0.64,
  ask_gap_median: -3.1,
  dom_sample: 410,
  median_dom: 19,
  active_count: 226,
  cut_share: 0.31,
  median_cut_pct: 9.3,
  median_true_dom: 38,
  computed_at: "2026-11-08T08:30:00.000Z",
  ...over,
});

describe("buildCommunityFacts", () => {
  it("states each fact as one sentence with the place, the number and the period", () => {
    const f = buildCommunityFacts("Unionville", "Markham", row())!;
    const t = Object.fromEntries(f.facts.map((x) => [x.id, x.text]));
    expect(t.price).toBe("The median sale price of all home types in Unionville, Markham was $1,388,000 over the last 12 months (412 sales).");
    expect(t.under_first_ask).toBe("In the last 12 months, 64% of homes in Unionville, Markham sold for less than their first asking price (405 sales); the median sale was 3.1% below the first asking price.");
    expect(t.days_to_sell).toBe("Homes in Unionville, Markham that sold in the last 12 months were on the market for a median of 19 days.");
    expect(t.price_cuts).toBe("Of the 226 homes for sale in Unionville, Markham now, 31% have cut their asking price; the median cut is 9.3%.");
    expect(t.true_dom).toBe("Homes for sale in Unionville, Markham now have been on the market for a median of 38 days when relists are counted as one listing.");
    expect(f.city).toBe("Unionville, Markham");
    expect(f.updatedLabel).toBe("November 8, 2026");
    expect(f.summary).toBe("Unionville, Markham market: median sale price $1,388,000 (12 mo); 64% sold below first asking; median 19 days to sell. Updated November 8, 2026.");
  });

  it("reads numeric strings (Postgres numeric arrives as text)", () => {
    const f = buildCommunityFacts("Unionville", "Markham", row({ under_ask_share: "0.640" as unknown as number }))!;
    expect(f.facts.find((x) => x.id === "under_first_ask")!.measure.value).toBe(64);
  });

  it("drops thin facts and keeps the rest", () => {
    const f = buildCommunityFacts("Unionville", "Markham", row({ sales_12m: 12, gap_sample: 12, dom_sample: 12 }))!;
    expect(f.facts.map((x) => x.id)).toEqual(["price_cuts", "true_dom"]);
    expect(f.summary).toBeNull();
    expect(buildCommunityFacts("Unionville", "Markham", row({ sales_12m: 5, gap_sample: 5, dom_sample: 5, active_count: 3 }))).toBeNull();
  });

  it("omits the median cut when nobody cut", () => {
    const t = buildCommunityFacts("Unionville", "Markham", row({ cut_share: 0, median_cut_pct: null }))!.facts.find((x) => x.id === "price_cuts")!.text;
    expect(t).toBe("Of the 226 homes for sale in Unionville, Markham now, 0% have cut their asking price.");
  });

  it("returns null without a row", () => {
    expect(buildCommunityFacts("Unionville", "Markham", null)).toBeNull();
  });
});
