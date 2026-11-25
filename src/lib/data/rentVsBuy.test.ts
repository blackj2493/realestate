import { describe, expect, it } from "vitest";
import { buildRentVsBuy, leanOf, rentBuyBeds } from "./rentVsBuy";
import type { MarketRow, RentalRow } from "./marketBoard";

const rr = (beds: number, typicalRent: number | null, medianPrice: number | null, grossYieldPct: number | null): RentalRow => ({ beds, typicalRent, medianPrice, grossYieldPct });
const row = (region: string, rentalRows: RentalRow[]): MarketRow => ({ region, rentalRows }) as unknown as MarketRow;

// 2-bed ratios: A 12.5, B 16.7, C 25.0, D 18.0, E 20.8
const others = [
  row("A", [rr(2, 2000, 300000, 8)]),
  row("B", [rr(2, 2000, 400000, 6)]),
  row("C", [rr(2, 2000, 600000, 4)]),
  row("D", [rr(2, 2500, 540000, 5.6)]),
  row("E", [rr(2, 2400, 600000, 4.8)]),
];
const AS_OF = "2026-11-20T12:00:00Z";

describe("rentVsBuy", () => {
  it("applies the published rule of thumb: under 15 buy, over 20 rent", () => {
    expect(leanOf(14.9)).toBe("buy");
    expect(leanOf(15)).toBe("neutral");
    expect(leanOf(20)).toBe("neutral");
    expect(leanOf(20.1)).toBe("rent");
  });

  it("states only bedroom rows with rent, price and a yield (the RPC's 5-sale gate)", () => {
    const beds = rentBuyBeds("Testville", row("Testville", [rr(1, 1800, 400000, 5.4), rr(2, 2200, null, null), rr(3, 2800, 700000, null), rr(4, 3200, 900000, 4.3), rr(5, 4000, 1200000, 4)]));
    expect(beds.map((b) => b.beds)).toEqual([1, 4]);
    expect(beds[0].ptr).toBe(18.5);
    expect(beds[0].text).toContain("$1,800 a month");
  });

  it("leads with the 2-bedroom row and ranks it among the covered cities", () => {
    const me = row("Testville", [rr(1, 1800, 400000, 5.4), rr(2, 2000, 360000, 6.7)]);
    const v = buildRentVsBuy("Testville", me, [...others, me], AS_OF, 2026)!;
    expect(v.lead.beds).toBe(2);
    expect(v.lead.ptr).toBe(15);
    expect(v.rank).toMatchObject({ position: 2, of: 6 });
    expect(v.rankText).toContain("number 2 of 6");
    expect(v.title).toBe("Is It Cheaper to Rent or Buy in Testville? 2026 Rent vs Buy by Bedroom Count");
    expect(v.faqs[0].a).toContain("gross figures");
  });

  it("falls back to the first stated row and skips the rank with no 2-bedroom row", () => {
    const me = row("Testville", [rr(3, 2500, 900000, 3.3)]);
    const v = buildRentVsBuy("Testville", me, [...others, me], AS_OF, 2026)!;
    expect(v.lead.beds).toBe(3);
    expect(v.lead.lean).toBe("rent");
    expect(v.rank).toBeNull();
  });

  it("returns null with no stated row or no date", () => {
    expect(buildRentVsBuy("X", row("X", [rr(2, 2000, null, null)]), others, AS_OF, 2026)).toBeNull();
    expect(buildRentVsBuy("X", row("X", [rr(2, 2000, 400000, 6)]), others, null, 2026)).toBeNull();
  });
});
