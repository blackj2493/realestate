import { describe, expect, it } from "vitest";
import { sameHomeChange, typeGroupOf, type PricedSale } from "./priceChangeModel";

/** Cells whose later median is exactly `factor` × the earlier one, with some noise in level. */
function synth(factor: number, cells = 60): PricedSale[] {
  const out: PricedSale[] = [];
  for (let c = 0; c < cells; c++) {
    const base = 500_000 + c * 10_000;
    for (const p of [0.95, 1, 1.05]) {
      out.push({ cell: `c${c}`, price: base * p, side: 0 });
      out.push({ cell: `c${c}`, price: base * p * factor, side: 1 });
    }
  }
  return out;
}

describe("priceChangeModel", () => {
  it("recovers a uniform same-home drop", () => {
    const c = sameHomeChange(synth(0.93))!;
    expect(c.pct).toBeCloseTo(-7, 5);
    expect(c.significant).toBe(true);
    expect(c.shareDown).toBe(1);
    expect(c.cells).toBe(60);
  });

  it("is not moved by a change in the mix of homes sold", () => {
    // Later period sells many more expensive cells, prices unchanged within each cell.
    const sales = synth(1);
    for (let i = 0; i < 30; i++) sales.push({ cell: "c59", price: 1_090_000, side: 1 });
    const c = sameHomeChange(sales)!;
    expect(Math.abs(c.pct)).toBeLessThan(0.5);
  });

  it("calls a zero change 'not significant' when cells disagree", () => {
    const sales: PricedSale[] = [];
    for (let c = 0; c < 40; c++) {
      const f = c % 2 ? 1.05 : 1 / 1.05;
      for (let k = 0; k < 3; k++) {
        sales.push({ cell: `c${c}`, price: 600_000, side: 0 });
        sales.push({ cell: `c${c}`, price: 600_000 * f, side: 1 });
      }
    }
    expect(sameHomeChange(sales)!.significant).toBe(false);
  });

  it("refuses too few cells, and cells short of sales on either side", () => {
    expect(sameHomeChange(synth(0.9, 10))).toBeNull();
    expect(sameHomeChange(synth(0.9).filter((s) => !(s.side === 0 && s.price % 2)), 3, 70)).toBeNull();
  });

  it("maps feed sub-types to the four groups", () => {
    expect(typeGroupOf("Semi-Detached ")).toBe("semiTown");
    expect(typeGroupOf("Condo Apartment")).toBe("condoApt");
    expect(typeGroupOf("Vacant Land")).toBeNull();
  });
});
