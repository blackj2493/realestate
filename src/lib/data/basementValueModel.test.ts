import { describe, expect, it } from "vitest";
import { basementFlags, fitBasementModel, median, parseBasement, solve, type SaleRow } from "./basementValueModel";

/** Synthetic sales with known effects: finished +6%, apartment +9%, entrance 0, bath +4%. */
function synth(seed = 7): SaleRow[] {
  let a = seed;
  const r = () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
  const rows: SaleRow[] = [];
  for (let c = 0; c < 300; c++) {
    const base = 13.5 + r(); // the cell's own price level
    for (let i = 0; i < 12; i++) {
      const u = r();
      const apt = u < 0.25;
      const fin = !apt && u < 0.6;
      const sep = r() < 0.3;
      const baths = 2 + (apt || fin ? 1 : 0) + (r() < 0.3 ? 1 : 0);
      const q = Math.floor(r() * 8);
      const y = base + (fin ? Math.log(1.02) : 0) + (apt ? Math.log(1.05) : 0) + (baths - 2) * Math.log(1.04) - q * 0.005 + (r() - 0.5) * 0.08;
      rows.push({
        cell: `c${c}`,
        price: Math.exp(y),
        date: `${2024 + Math.floor(q / 4)}-${String((q % 4) * 3 + 1).padStart(2, "0")}-15`,
        apt, fin, part: false, sep, reno: false, fix: false,
        baths, parking: 2, lotWidth: 30 + r() * 20,
      });
    }
  }
  return rows;
}

describe("basementValueModel", () => {
  it("solves a small linear system", () => {
    expect(solve([[2, 1], [1, 3]], [3, 5])!.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.8, 1.4]);
    expect(solve([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });

  it("model B (with baths) recovers the planted basement and bathroom effects", () => {
    const fit = fitBasementModel(synth(), true)!;
    expect(fit.effects.fin.pct).toBeCloseTo(2, 0);
    expect(fit.effects.apt.pct).toBeCloseTo(5, 0);
    expect(fit.effects.baths.pct).toBeCloseTo(4, 0);
    expect(fit.effects.apt.significant).toBe(true);
    // No planted entrance effect: its range must straddle zero.
    expect(fit.effects.sep.lo).toBeLessThan(0);
    expect(fit.effects.sep.hi).toBeGreaterThan(0);
  });

  it("model A (no baths) folds the basement bathroom into the basement gap", () => {
    const fit = fitBasementModel(synth(), false)!;
    // Finished houses carry one extra bath: 1.02 × 1.04 ≈ +6%.
    expect(fit.effects.fin.pct).toBeGreaterThan(5);
    expect(fit.effects.fin.pct).toBeLessThan(7.5);
  });

  it("is deterministic for the same data and seed", () => {
    const a = fitBasementModel(synth(), false, 3)!;
    const b = fitBasementModel(synth(), false, 3)!;
    expect(a.effects.fin).toEqual(b.effects.fin);
  });

  it("refuses a sample too small to fit", () => {
    expect(fitBasementModel(synth().slice(0, 100), false)).toBeNull();
  });

  it("reads the feed's basement field and gives the apartment precedence", () => {
    expect([...parseBasement('["Finished","Separate Entrance"]')]).toEqual(["Finished", "Separate Entrance"]);
    expect([...parseBasement(["Apartment"])]).toEqual(["Apartment"]);
    expect(parseBasement(null).size).toBe(0);
    expect(basementFlags(new Set(["Finished", "Apartment"]), 0)).toMatchObject({ apt: true, fin: false });
    expect(basementFlags(new Set(["Finished"]), 1)).toMatchObject({ apt: true, fin: false });
    expect(basementFlags(new Set(["Partially Finished"]), 0)).toMatchObject({ part: true, fin: false });
  });

  it("takes the median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
