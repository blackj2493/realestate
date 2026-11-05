import { describe, expect, it } from "vitest";
import { buildCityFacts, boardRowFor } from "./cityFacts";
import type { MarketRow } from "./marketBoard";

const row = (over: Partial<MarketRow> = {}): MarketRow => ({
  region: "Markham",
  medianPrice: 1050000, avgPrice: 1111225, yoyPct: -4, medianPpsf: 600, activeCount: 1267, monthsOfSupply: 4.6,
  soldToListPct: 99, trueDom: 60, medianNaiveDom: 40, soldMedianDom: 21, soldP25Dom: 12, soldP75Dom: 42,
  sellThroughPct: 70, stalePct: 49.8, temperature: "balanced", priceSeries: [],
  cutShare: 0.2577, cutCount: 326, cutActive: 1265, medianCutPct: 8.6, medianCutAmt: 100000,
  domBuckets: null, rentalRows: [],
  underAskShare: 0.66, askGapMedian: -2.9, soldCount12m: 2714, pctOverAsking: 27.6, sales90: 749,
  monthly: [
    { month: "2025-10", medianPrice: 1100000, sales: 260 },
    { month: "2026-09", medianPrice: 1059000, sales: 252 },
    { month: "2026-10", medianPrice: 1050000, sales: 249 },
    { month: "2026-11", medianPrice: 990000, sales: 12 }, // partial month: must be skipped
  ],
  ...over,
} as MarketRow);

const AS_OF = "2026-11-05T05:15:12.339Z";

describe("buildCityFacts", () => {
  it("states each fact as one sentence with the place, the number and the period", () => {
    const f = buildCityFacts("Markham", row(), AS_OF)!;
    const t = Object.fromEntries(f.facts.map((x) => [x.id, x.text]));
    expect(t.price).toBe("The median sale price of all home types in Markham was $1,050,000 in October 2026 (249 sales), 4.5% lower than in October 2025 ($1,100,000).");
    expect(t.under_first_ask).toBe("In the last 12 months, 66% of homes in Markham sold for less than their first asking price (2,714 sales); the median sale was 2.9% below the first asking price.");
    expect(t.final_ask).toBe("In the last 90 days, homes in Markham sold for an average of 99.0% of their final asking price, and 27.6% sold above it.");
    expect(t.days_to_sell).toBe("Homes in Markham that sold in the last 12 months were on the market for a median of 21 days; half sold in 12 to 42 days.");
    expect(t.price_cuts).toBe("Of the 1,265 homes for sale in Markham now, 26% have cut their asking price; the median cut is 8.6%.");
    expect(t.true_dom).toContain("median of 60 days when relists are counted as one listing (the listings show a median of 40 days)");
    expect(f.updatedLabel).toBe("November 5, 2026");
  });

  it("says 'the same as' when the yearly change rounds to zero", () => {
    const flat = row({ monthly: [{ month: "2025-10", medianPrice: 845000, sales: 2000 }, { month: "2026-10", medianPrice: 845000, sales: 2113 }] });
    const t = buildCityFacts("Toronto", flat, AS_OF)!.facts.find((x) => x.id === "price")!.text;
    expect(t).toBe("The median sale price of all home types in Toronto was $845,000 in October 2026 (2,113 sales), the same as in October 2025.");
  });

  it("skips the partial current month for the price", () => {
    const f = buildCityFacts("Markham", row(), AS_OF)!;
    expect(f.facts.find((x) => x.id === "price")!.measure.value).toBe(1050000);
  });

  it("drops a fact whose sample is thin, and returns null when nothing is left", () => {
    const thin = row({ soldCount12m: 10, sales90: 5, cutActive: 5, activeCount: 5, monthly: [{ month: "2026-10", medianPrice: 1, sales: 3 }] });
    expect(buildCityFacts("Markham", thin, AS_OF)).toBeNull();
    const noUnder = buildCityFacts("Markham", row({ underAskShare: null }), AS_OF)!;
    expect(noUnder.facts.map((x) => x.id)).not.toContain("under_first_ask");
  });

  it("builds FAQ answers from the same sentences, and a short summary", () => {
    const f = buildCityFacts("Markham", row(), AS_OF)!;
    const below = f.faqs.find((q) => q.q === "Do homes in Markham sell below asking price?")!;
    expect(below.a).toContain("66% of homes in Markham sold for less than their first asking price");
    expect(f.summary).toBe("Markham market: Median sale price $1,050,000 (October 2026); 66% sold below first asking (12 mo); median 21 days to sell. Updated November 5, 2026.");
  });

  it("returns null without a row or a date", () => {
    expect(buildCityFacts("Markham", null, AS_OF)).toBeNull();
    expect(buildCityFacts("Markham", row(), null)).toBeNull();
  });
});

describe("boardRowFor", () => {
  it("matches the hub display name case-insensitively", () => {
    expect(boardRowFor([row({ region: "Richmond Hill" })], "richmond hill")?.region).toBe("Richmond Hill");
    expect(boardRowFor([row()], "Brampton")).toBeNull();
  });
});
