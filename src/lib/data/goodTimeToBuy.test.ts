import { describe, expect, it } from "vitest";
import { buildBuyVerdict, buyFaqs, stale90 } from "./goodTimeToBuy";
import type { MarketRow } from "./marketBoard";
import type { PriceChangeArea } from "./priceChange";

const row = (over: Partial<MarketRow>): MarketRow =>
  ({
    region: "Testville",
    temperature: "balanced",
    monthsOfSupply: 4.5,
    soldToListPct: 97.2,
    cutShare: 0.3,
    medianCutPct: 4.1,
    domBuckets: { d0_14: 100, d15_30: 100, d31_60: 100, d61_90: 50, d90plus: 150 },
    ...over,
  }) as MarketRow;
const LOW_STALE = { d0_14: 200, d15_30: 100, d31_60: 100, d61_90: 50, d90plus: 50 };
const others = [row({ cutShare: 0.2, domBuckets: LOW_STALE }), row({ cutShare: 0.25, domBuckets: LOW_STALE })];
const change = { all: { pct: -7, lo: -8, hi: -6, significant: true, cells: 100, sales: 1000, shareDown: 0.8 } } as unknown as PriceChangeArea;

describe("goodTimeToBuy", () => {
  it("reads the 90-day share from the listing-age buckets", () => {
    expect(stale90(row({}))).toBeCloseTo(30, 5);
    expect(stale90(row({ domBuckets: null }))).toBeNull();
  });

  it("counts each measured signal and its direction", () => {
    const v = buildBuyVerdict("Testville", row({}), [row({}), ...others], change)!;
    const lean = Object.fromEntries(v.signals.map((s) => [s.id, s.lean]));
    expect(lean).toEqual({ temperature: "neutral", price: "buyers", saleToList: "buyers", cuts: "buyers", stale: "buyers" });
    expect(v.forBuyers).toBe(4);
    expect(v.market).toBe("a balanced market that leans to buyers");
    expect(v.summary).toContain("4 of 5 measured signals favour buyers");
  });

  it("follows the shared temperature rule for the market label", () => {
    expect(buildBuyVerdict("Hotville", row({ temperature: "hot", soldToListPct: 101 }), others, null)!.market).toBe("a seller's market");
  });

  it("never counts a missing signal, and refuses fewer than 3", () => {
    expect(buildBuyVerdict("X", row({ temperature: null, soldToListPct: null, cutShare: null }), others, null)).toBeNull();
  });

  it("says the page measures the market, not the reader's situation", () => {
    const v = buildBuyVerdict("Testville", row({}), others, change)!;
    expect(buyFaqs("Testville", v, 2026)[0].a).toContain("this page measures the market only");
  });
});
