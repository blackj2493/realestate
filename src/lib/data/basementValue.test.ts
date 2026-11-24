import { describe, expect, it } from "vitest";
import { buildBasementFacts, gapText, getBasementData, lastMonthLabel, rankedCities, type BasementCity, type BasementValueFile } from "./basementValue";

const eff = (pct: number, significant: boolean) => ({ pct, lo: significant ? pct - 1 : -1, hi: pct + 1, significant });

const city: BasementCity = {
  city: "Testville",
  slug: "testville",
  sales: 4000,
  medianPrice: 1_000_000,
  groups: { apt: 900, fin: 2000, ref: 600 },
  modelA: { n: 3800, cells: 400, effects: { fin: eff(6, true), apt: eff(7, true), sep: eff(0.5, false), reno: eff(4, true), fix: eff(-10, true) }, aptMinusFin: { pct: 1, lo: -1, hi: 3, significant: false } },
  modelB: { n: 3800, cells: 400, effects: { baths: eff(5, true), fin: eff(0.2, false), apt: eff(3, true), sep: eff(0.4, false), reno: eff(4, true), fix: eff(-10, true) }, aptMinusFin: { pct: 2.8, lo: 1, hi: 4, significant: true } },
  rent: { oneBed: null, twoBed: { median: 1800, leases: 200 } },
};
const file: BasementValueFile = { generatedAt: "2026-11-24T12:00:00Z", salesFrom: "2024-11-01", salesTo: "2026-11-01", rentsFrom: "2025-11-01", rentsTo: "2026-11-01", cities: [city] };

describe("basementValue", () => {
  it("never gives a dollar figure for a gap that is not significant", () => {
    expect(gapText(eff(0.5, false), 1_000_000)).toBe("+0.5%, not significant");
    expect(gapText(eff(6, true), 1_000_000)).toBe("+6.0% (about $60,000)");
    const f = buildBasementFacts(city, file)!;
    const sep = f.facts.find((x) => x.id === "sep")!.text;
    expect(sep).toContain("not significant");
    expect(sep).not.toMatch(/\$/);
  });

  it("states the window, the payback against cost, and the rent", () => {
    const f = buildBasementFacts(city, file)!;
    expect(f.window).toBe("Nov 2024 to Oct 2026");
    expect(f.facts[0].text).toContain("More than its typical cost of about $40,000");
    expect(f.facts[1].text).toContain("not significant"); // apt − fin
    expect(f.facts.find((x) => x.id === "rent")!.text).toContain("$1,800 a month for 2 bedrooms");
    expect(f.faqs.map((q) => q.q)).toContain("How much does a basement apartment rent for in Testville?");
  });

  it("returns null for a city without a model", () => {
    expect(buildBasementFacts({ ...city, modelA: null }, file)).toBeNull();
  });

  it("labels the last month of an exclusive end date", () => {
    expect(lastMonthLabel("2026-11-01")).toBe("Oct 2026");
    expect(lastMonthLabel("2027-01-01")).toBe("Dec 2026");
  });

  it("the committed data file covers every city it lists, with a model, ranked", () => {
    const data = getBasementData();
    const ranked = rankedCities(data);
    expect(ranked.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].modelA!.effects.fin.pct).toBeGreaterThanOrEqual(ranked[i].modelA!.effects.fin.pct);
    }
    for (const c of ranked) expect(buildBasementFacts(c, data)).not.toBeNull();
  });
});
