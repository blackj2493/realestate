import { describe, expect, it } from "vitest";
import type { MarketRow } from "./marketBoard";
import { buildSellingTime } from "./sellingTime";

function row(region: string, over: Partial<MarketRow> = {}): MarketRow {
  return {
    region,
    medianPrice: null, avgPrice: null, yoyPct: null, medianPpsf: null,
    activeCount: 400, monthsOfSupply: null, soldToListPct: null,
    trueDom: 61, medianNaiveDom: 38,
    soldMedianDom: 22, soldP25Dom: 10, soldP75Dom: 45,
    sellThroughPct: null, stalePct: null, temperature: null as unknown as MarketRow["temperature"],
    priceSeries: [], cutShare: null, cutCount: null, cutActive: null, medianCutPct: null, medianCutAmt: null,
    domBuckets: { d0_14: 100, d15_30: 80, d31_60: 90, d61_90: 50, d90plus: 80 },
    rentalRows: [], underAskShare: null, askGapMedian: null, soldCount12m: 1200,
    pctOverAsking: null, sales90: null,
    // 25 months to Nov 2026 (partial): Nov 2024 .. Nov 2026; per-month sales by calendar month.
    monthly: Array.from({ length: 25 }, (_, i) => {
      const t = 2024 * 12 + 10 + i; // Nov 2024 = index 0
      const m = (t % 12) + 1;
      return { month: `${Math.floor(t / 12)}-${String(m).padStart(2, "0")}`, medianPrice: 1, sales: [150, 175, 300, 350, 360, 325, 250, 240, 225, 210, 190, 120][m - 1] };
    }),
    seasonality: [],
    ...over,
  };
}

const AS_OF = "2026-11-09T08:00:00Z";

describe("buildSellingTime", () => {
  it("states sold-side, true-clock, 90+ day and busiest-month facts", () => {
    const rows = [row("Markham"), row("Toronto", { soldMedianDom: 30 }), row("Oshawa", { soldMedianDom: 15 }), row("Ajax", { soldMedianDom: 18 }), row("Milton", { soldMedianDom: 40 })];
    const s = buildSellingTime("Markham", rows[0], rows, AS_OF)!;
    const text = s.facts.map((f) => f.text).join(" ");
    expect(text).toContain("median of 22 days");
    expect(text).toContain("Half of them sold in 10 to 45 days");
    expect(text).toContain("median of 61 days");
    expect(text).toContain("23 days fewer");
    expect(text).toContain("20% of the homes for sale"); // 80 / 400
    expect(s.seasonText).toContain("most homes in Markham sold in May, April and June");
    expect(s.seasonText).toContain("fewest in December");
    expect(s.seasonText).toContain("3.0 times");
    expect(s.seasonText).toContain("Over the last 2 years (November 2024 to October 2026)");
    expect(s.months?.find((m) => m.month === 5)?.sales).toBe(720);
    expect(s.rankText).toContain("number 3 of 5");
    expect(s.title).toBe("How Long Does It Take to Sell a House in Markham? (November 2026)");
    expect(s.faqs.map((f) => f.q)).toContain("What is the best month to sell a house in Markham?");
  });

  it("drops figures whose sample is too small", () => {
    const thin = row("Ajax", { soldCount12m: 20, activeCount: 10, domBuckets: null });
    const s = buildSellingTime("Ajax", thin, [thin], AS_OF)!;
    expect(s.facts.map((f) => f.id)).toEqual(["busiest_month"]);
    expect(s.rankText).toBeNull();
  });

  it("has no month chart when a month of the 24 is missing", () => {
    const r = row("Ajax", { monthly: row("x").monthly.filter((p) => p.month !== "2025-03") });
    const s = buildSellingTime("Ajax", r, [r], AS_OF)!;
    expect(s.months).toBeNull();
    expect(s.seasonText).toBeNull();
  });

  it("returns null without a row", () => {
    expect(buildSellingTime("Ajax", null, [], AS_OF)).toBeNull();
  });
});
