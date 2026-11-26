import { describe, expect, it } from "vitest";
import { BANK_FORECASTS, forecastAnswer, forecastDateLabel, forecastRange, type BankForecast } from "./bankForecasts";

const f = (source: string, published: string, pricePct: number, salesPct: number, year = 2027): BankForecast => ({
  source,
  report: "r",
  url: "https://example.com",
  published,
  year,
  pricePct,
  salesPct,
});

describe("bankForecasts", () => {
  it("every entry has a source link, an ISO date and a forecast year after it was published", () => {
    for (const b of BANK_FORECASTS) {
      expect(b.url).toMatch(/^https:\/\//);
      expect(b.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.year).toBeGreaterThan(Number(b.published.slice(0, 4)));
    }
  });

  it("gives the range for one year, newest first", () => {
    const r = forecastRange(2027, [f("A", "2026-09-01", 0.7, 8.2), f("B", "2026-11-16", 2.3, 4.6), f("C", "2026-10-16", 0.6, 5.3), f("D", "2026-10-01", 9, 9, 2028)])!;
    expect(r.forecasts.map((x) => x.source)).toEqual(["B", "C", "A"]);
    expect([r.priceLow, r.priceHigh, r.salesLow, r.salesHigh]).toEqual([0.6, 2.3, 4.6, 8.2]);
    expect(r.publishedSpan).toBe("September to November 2026");
    expect(forecastRange(2029, [f("A", "2026-09-01", 1, 1)])).toBeNull();
  });

  it("answers the forecast question without a forecast of its own", () => {
    const r = forecastRange(2027, [f("CREA", "2026-10-16", 0.7, 5.3), f("TD", "2026-09-29", -0.4, 7.4)])!;
    const a = forecastAnswer("Vaughan", r, "Prices in Vaughan fell 2.0%.");
    expect(a).toBe(
      "PureProperty does not forecast prices. The 2 forecasts for Ontario published from September to October 2026 (CREA, TD) expect home prices to change by -0.4% to +0.7% in 2027, and home sales by +5.3% to +7.4%. None of them publishes a forecast for Vaughan alone. Prices in Vaughan fell 2.0%.",
    );
  });

  it("labels a date in words", () => {
    expect(forecastDateLabel("2026-11-16")).toBe("November 16, 2026");
  });
});
