import { describe, expect, it } from "vitest";
import { HOME_VALUE_CITIES, homeValueCityBySlug, homeValueFaqs, homeValuePath } from "./content";
import type { CityFacts } from "@/lib/data/cityFacts";

const facts = {
  city: "Markham",
  facts: [
    { id: "price", text: "The median sale price of all home types in Markham was $1,050,000 in October 2026 (249 sales).", measure: { name: "", value: 0, unitText: "" } },
    { id: "under_first_ask", text: "In the last 12 months, 66% of homes in Markham sold for less than their first asking price (2,714 sales).", measure: { name: "", value: 0, unitText: "" } },
  ],
  faqs: [],
  updatedLabel: "November 8, 2026",
  updatedIso: "2026-11-08T08:00:00.000Z",
  summary: null,
} as CityFacts;

describe("home value content", () => {
  it("covers the 15 board cities with hub-style slugs", () => {
    expect(HOME_VALUE_CITIES).toHaveLength(15);
    expect(homeValueCityBySlug("richmond-hill")).toBe("Richmond Hill");
    expect(homeValueCityBySlug("nowhere")).toBeNull();
    expect(homeValuePath("markham")).toBe("/home-value/markham");
    expect(homeValuePath()).toBe("/home-value");
  });

  it("answers the searched questions with the city facts and no valuation", () => {
    const faqs = homeValueFaqs("Markham", facts);
    const worth = faqs.find((f) => f.q === "How much is my house worth in Markham?")!;
    expect(worth.a).toContain("$1,050,000 in October 2026");
    expect(worth.a).toContain("A person checks every opinion");
    const now = faqs.find((f) => f.q === "Should I sell my house now or wait?")!;
    expect(now.a).toContain("does not forecast");
    expect(faqs.find((f) => f.q === "How accurate are online home value estimates?")!.a).toContain("about 8%");
  });

  it("still answers without facts (the Ontario page)", () => {
    const faqs = homeValueFaqs("Ontario", null);
    expect(faqs.every((f) => f.a.length > 20)).toBe(true);
  });
});
