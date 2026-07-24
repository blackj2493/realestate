import { describe, it, expect } from "vitest";
import { buildBedsTypeMatrix, pickRentMatrix } from "./nearbyForSale";

const r = (beds: number | null, subType: string | null, price: number) => ({ beds, subType, price });

describe("buildBedsTypeMatrix", () => {
  it("builds beds × type medians from live rentals", () => {
    const m = buildBedsTypeMatrix([
      r(2, "Condo Apartment", 2400),
      r(2, "Condo Apartment", 2500),
      r(1, "Condo Apartment", 2100),
      r(1, "Condo Apartment", 1900),
      r(3, "Detached", 3600),
      r(3, "Detached", 3400),
    ]);
    expect(m).not.toBeNull();
    expect(m!.sample).toBe(6);
    expect(m!.bedCols).toEqual([1, 2, 3]);
    const condo = m!.rows.find((x) => x.label === "Condo Apartment")!;
    expect(condo.cells[0].median).toBe(2000); // 1 bd
    expect(condo.cells[1].median).toBe(2450); // 2 bd
    expect(condo.cells[2].median).toBeNull(); // no 3 bd condos
    const det = m!.rows.find((x) => x.label === "Detached")!;
    expect(det.cells[2].median).toBe(3500);
  });

  it("hides single-sample cells (a lone lease is not 'typical') but keeps the count", () => {
    const m = buildBedsTypeMatrix([
      r(2, "Condo Apartment", 2400),
      r(2, "Condo Apartment", 2500),
      r(3, "Condo Apartment", 9800), // lone outlier
      r(1, "Condo Apartment", 2000),
      r(1, "Condo Apartment", 2100),
    ]);
    const condo = m!.rows[0];
    const threeBd = condo.cells[m!.bedCols.indexOf(3)];
    expect(threeBd.median).toBeNull();
    expect(threeBd.count).toBe(1);
  });

  it("buckets 4+ bedrooms together and drops bedless/typeless/free rows", () => {
    const m = buildBedsTypeMatrix([
      r(4, "Detached", 4200),
      r(5, "Detached", 4800),
      r(6, "Detached", 5000),
      r(null, "Detached", 3000),
      r(3, null, 3000),
      r(3, "Detached", 0),
      r(2, "Condo Apartment", 2400),
      r(2, "Condo Apartment", 2500),
    ]);
    expect(m!.bedCols).toEqual([2, 4]);
    const det = m!.rows.find((x) => x.label === "Detached")!;
    expect(det.cells[m!.bedCols.indexOf(4)].median).toBe(4800);
    expect(m!.sample).toBe(5);
  });

  it("returns null under the minimum sample so the panel self-hides", () => {
    expect(buildBedsTypeMatrix([r(2, "Condo Apartment", 2400), r(2, "Condo Apartment", 2500)])).toBeNull();
  });

  it("returns null when every cell would hide (all lone samples)", () => {
    const m = buildBedsTypeMatrix([
      r(1, "A", 1000),
      r(2, "B", 2000),
      r(3, "C", 3000),
      r(4, "D", 4000),
      r(1, "E", 1500),
    ]);
    expect(m).toBeNull();
  });
});

describe("pickRentMatrix", () => {
  const m = (sample: number) => ({ bedCols: [2], rows: [{ label: "Detached", cells: [{ median: 3000, count: sample }], count: sample }], sample });

  it("keeps the local grid when dense enough", () => {
    expect(pickRentMatrix(m(12), 2, m(40), 5)!.radiusKm).toBe(2);
  });

  it("widens when the local grid is thin and the wide one is richer", () => {
    const picked = pickRentMatrix(m(5), 2, m(30), 5)!;
    expect(picked.radiusKm).toBe(5);
    expect(picked.matrix.sample).toBe(30);
  });

  it("keeps the thin local grid when widening gained nothing", () => {
    expect(pickRentMatrix(m(5), 2, m(5), 5)!.radiusKm).toBe(2);
    expect(pickRentMatrix(m(5), 2, null, 5)!.radiusKm).toBe(2);
  });

  it("null local + usable wide -> wide; both null -> null", () => {
    expect(pickRentMatrix(null, 2, m(8), 5)!.radiusKm).toBe(5);
    expect(pickRentMatrix(null, 2, null, 5)).toBeNull();
  });
});
