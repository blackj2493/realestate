import { describe, expect, it } from "vitest";
import { bestMonths, buildBestTimeFacts, getBestTimeData, seasonSpread, worstMonths, type BestTimeFile, type MonthStats, type SellCity } from "./bestTimeToSell";
import { monthEffects } from "./bestTimeToSellModel";
import { fitWithinCell, type CellRow } from "./withinCellModel";

const gap = (pct: number, significant = true) => ({ pct, lo: pct - 0.5, hi: pct + 0.5, significant });
const month = (m: number, pct: number, significant = true, dom = 20, over = 20): MonthStats => ({
  month: m,
  sales: 300,
  saleToAsk: 97,
  overAskShare: over,
  medianDom: dom,
  price: gap(pct, significant),
});
const city: SellCity = {
  city: "Testville",
  slug: "testville",
  sales: 3600,
  months: [
    month(1, -1, false, 32, 12),
    month(2, 0.5, false),
    month(3, 1),
    month(4, 2.5, true, 17, 30),
    month(5, 2),
    month(6, 0.4, false),
    month(7, 0),
    month(8, -0.3, false),
    month(9, 0.1, false),
    month(10, -0.5, false),
    month(11, -1.5),
    month(12, -3, true, 35, 10),
  ],
  weekdays: [1, 2, 3, 4, 5].map((day) => ({ day, sales: 500, overAskShare: 20, medianDom: 20 + day })),
};
const file: BestTimeFile = { generatedAt: "2026-11-24T00:00:00Z", from: "2024-11-01", to: "2026-11-01", cities: [city] };

describe("best and worst months", () => {
  it("names only significant months, strongest first", () => {
    expect(bestMonths(city).map((m) => m.month)).toEqual([4, 5, 3]);
    expect(worstMonths(city).map((m) => m.month)).toEqual([12, 11]);
    expect(seasonSpread(city)).toBeCloseTo(5.5);
  });

  it("says so when no month is significant", () => {
    const flat = { ...city, months: city.months.map((m) => ({ ...m, price: gap(m.price!.pct, false) })) };
    const f = buildBestTimeFacts(flat, file, 2026);
    expect(f.facts[0].text).toContain("no month gave a measurable price premium");
    expect(seasonSpread(flat)).toBeNull();
  });
});

describe("buildBestTimeFacts", () => {
  const f = buildBestTimeFacts(city, file, 2026);
  it("leads with the best months and converts to a listing date", () => {
    expect(f.facts[0].text).toBe("In Testville, similar homes sold for the most when the deal was signed in April, May and March: +2.5% in April, +2.0% in May and +1.0% in March, against the average month.");
    expect(f.facts.find((x) => x.id === "worst")!.text).toBe("The weakest: December (−3.0%) and November (−1.5%).");
    expect(f.facts.find((x) => x.id === "list")!.text).toContain("listed in early April");
    expect(f.facts.find((x) => x.id === "speed")!.text).toContain("fastest in April (median 17 days");
    expect(f.facts.find((x) => x.id === "weekday")!.text).toBe("Homes listed on a Monday sold in a median 21 days, against 25 days for a Friday.");
    expect(f.facts.find((x) => x.id === "basis")!.text).toBe("3,600 sales in Testville, Nov 2024 to Oct 2026 (every calendar month counted twice).");
    expect(f.title).toBe("Best Time to Sell a House in Testville (2026): Price, Speed and Over-Asking by Month");
  });
});

describe("monthEffects", () => {
  it("recovers a planted season against the average month, with the trend removed", () => {
    // Season: +3% in April, -3% in December, 0 otherwise; plus a steady 0.5%/month decline.
    const season = (m: number) => (m === 4 ? 0.03 : m === 12 ? -0.03 : 0);
    let seed = 3;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
    const rows: CellRow[] = [];
    for (let cell = 0; cell < 60; cell++) {
      for (let t = 0; t < 24; t++) {
        const m = (t % 12) + 1;
        const tt = (t - 12) / 12;
        rows.push({ cell: `c${cell}`, y: 13 + cell * 0.01 + season(m) - 0.005 * t + noise(), x: [...Array.from({ length: 11 }, (_, i) => +(m === i + 2)), tt, tt * tt] });
      }
    }
    const terms = Array.from({ length: 11 }, (_, i) => `m${i + 2}`);
    const fit = fitWithinCell(rows, [...terms, "trend", "trend2"], { keepDraws: true, boot: 100, seed: 1 })!;
    const e = monthEffects(fit, terms)!;
    expect(e).toHaveLength(12);
    // Mean of the planted season is 0, so the centred effects equal it.
    expect(e[3]!.pct).toBeCloseTo(3.05, 0);
    expect(e[11]!.pct).toBeCloseTo(-2.96, 0);
    expect(e[3]!.significant).toBe(true);
    expect(Math.abs(e[6]!.pct)).toBeLessThan(0.5);
  });

  it("returns null without the draws", () => {
    const terms = Array.from({ length: 11 }, (_, i) => `m${i + 2}`);
    expect(monthEffects({ n: 1, cells: 1, coef: {} }, terms)).toBeNull();
  });
});

describe("the committed data", () => {
  it("covers every month for every city", () => {
    const d = getBestTimeData();
    expect(d.cities.length).toBeGreaterThanOrEqual(10);
    for (const c of d.cities) {
      expect(c.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(buildBestTimeFacts(c, d, 2026).facts.length).toBeGreaterThan(2);
    }
  });
});
