import { describe, expect, it } from "vitest";
import { buildLttFacts, lttCities, lttCityBySlug, lttRows } from "./landTransferTaxPages";

describe("landTransferTaxPages", () => {
  it("adds the municipal tax in Toronto only", () => {
    const to = lttRows(lttCityBySlug("toronto")!)[0];
    expect(to.buyer.toronto).toBeGreaterThan(0);
    expect(to.buyer.total).toBe(to.buyer.ontario + to.buyer.toronto);
    const mi = lttRows(lttCityBySlug("mississauga")!)[0];
    expect(mi.buyer.toronto).toBe(0);
  });

  it("states the tax on the median home and answers the searched questions", () => {
    const f = buildLttFacts(lttCityBySlug("vaughan")!, 2026);
    expect(f.title).toBe("Land Transfer Tax in Vaughan (2026): Calculator and What Buyers Pay");
    expect(f.facts[0].text).toMatch(/^On Vaughan's median sold price of \$[\d,]+, a buyer pays \$[\d,]+ in Ontario land transfer tax; a first-time buyer pays \$[\d,]+\.$/);
    expect(f.faqs.map((q) => q.q)).toEqual([
      "How much is land transfer tax in Vaughan?",
      "How much land transfer tax does a first-time buyer pay in Vaughan?",
      "Does Vaughan have a municipal land transfer tax?",
      "When do you pay land transfer tax?",
    ]);
  });

  it("builds every city in the sold prices file", () => {
    expect(lttCities().length).toBeGreaterThanOrEqual(30);
    for (const c of lttCities()) expect(buildLttFacts(c, 2026).facts.length).toBeGreaterThan(1);
  });
});
