import { describe, expect, it } from "vitest";
import { buildOutlook, outlookYear } from "./marketOutlook";
import type { MarketRow } from "./marketBoard";

const months = (from: string, n: number) => {
  const [y0, m0] = from.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const t = y0 * 12 + (m0 - 1) + i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
};

// 24 months Nov 2024 .. Oct 2026, plus a partial Nov 2026 that must be ignored.
const monthly = [
  ...months("2024-11", 24).map((month) => {
    const y = month.slice(0, 4);
    const peak = month >= "2025-04" && month <= "2025-06";
    return {
      month,
      medianPrice: peak ? 1_000_000 : y === "2026" ? 800_000 : 850_000,
      sales: y === "2026" ? 600 : 500,
      soldToList: y === "2026" ? 98.5 : 99.0,
    };
  }),
  { month: "2026-11", medianPrice: 1, sales: 10, soldToList: 90 },
];

const row = (over: Partial<MarketRow> = {}): MarketRow =>
  ({
    region: "Toronto",
    temperature: "balanced",
    underAskShare: 0.73,
    askGapMedian: -3.1,
    soldCount12m: 21000,
    cutShare: 0.27,
    cutActive: 11103,
    medianCutPct: 8.3,
    monthly,
    seasonality: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, sales: i === 9 ? 5400 : i === 0 ? 2000 : 4000, priceIndexPct: 0, soldToList: 99 })),
    ...over,
  }) as MarketRow;

const AS_OF = "2026-11-08T08:00:00.000Z";

describe("buildOutlook", () => {
  it("compares the last three full months with the same months a year earlier", () => {
    const o = buildOutlook("Toronto", row(), AS_OF)!;
    const t = Object.fromEntries(o.facts.map((f) => [f.id, f.text]));
    expect(t.price_change).toBe(
      "From August to October 2026, the monthly median sale price of all home types in Toronto averaged $800,000, 5.9% lower than in the same months of 2025 ($850,000)."
    );
    expect(t.sales_change).toBe("1,800 homes sold in Toronto from August to October 2026, 20% more than in the same months of 2025 (1,500).");
    expect(t.final_ask).toBe("From August to October 2026, homes in Toronto sold for an average of 98.5% of their final asking price, compared with 99.0% a year earlier.");
  });

  it("measures the gap from the two-year high of the 3-month price", () => {
    const t = buildOutlook("Toronto", row(), AS_OF)!.facts.find((f) => f.id === "from_high")!.text;
    expect(t).toBe("The 3-month median sale price in Toronto is 20.0% below its highest level since November 2024, which was $1,000,000 from April to June 2025.");
  });

  it("uses sales, not prices, for the month-of-year pattern, over the last 24 full months", () => {
    const shaped = monthly.map((p) => ({ ...p, sales: p.month.endsWith("-10") ? 900 : p.month.endsWith("-01") ? 200 : p.sales }));
    const o = buildOutlook("Toronto", row({ monthly: shaped }), AS_OF)!;
    expect(o.seasonText).toContain("Over the last 2 years (November 2024 to October 2026)");
    expect(o.seasonText).toContain("the most homes in Toronto sold in October");
    expect(o.seasonText).toContain("the fewest in January");
    expect(o.seasonText).not.toMatch(/above that year/);
  });

  it("answers the searched questions without forecasting", () => {
    const o = buildOutlook("Toronto", row(), AS_OF)!;
    expect(o.title).toBe("Toronto Housing Market 2027: What the Data Shows Now");
    const drop = o.faqs.find((f) => f.q === "Will house prices drop in Toronto in 2027?")!;
    expect(drop.a.startsWith("No one can know future prices, and PureProperty does not forecast them.")).toBe(true);
    expect(o.faqs.map((f) => f.q)).toContain("Is the Toronto housing market crashing?");
    expect(o.marketType).toBe("balanced market");
  });

  it("drops the comparison when a window is thin, and returns null when nothing is left", () => {
    const thin = row({ monthly: monthly.map((p) => ({ ...p, sales: 10 })), underAskShare: null, cutShare: null });
    expect(buildOutlook("Toronto", thin, AS_OF)).toBeNull();
    const noTrend = buildOutlook("Toronto", row({ monthly: [] }), AS_OF)!;
    expect(noTrend.facts.map((f) => f.id)).toEqual(["under_first_ask", "price_cuts"]);
  });

  it("asks about next year from September on", () => {
    expect(outlookYear("2026-11-08T08:00:00.000Z")).toBe(2027);
    expect(outlookYear("2026-05-08T08:00:00.000Z")).toBe(2026);
  });
});
