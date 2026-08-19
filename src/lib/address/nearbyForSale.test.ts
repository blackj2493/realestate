import { describe, it, expect } from "vitest";
import { buildBedsTypeMatrix, pickRentMatrix, isPartialUnitRental, IN_HOME_UNIT_LABEL } from "./nearbyForSale";

// `beds` here means WHOLE bedrooms above grade (no plus-room). Use `rDen` for a "+1".
const r = (beds: number | null, subType: string | null, price: number) => ({
  beds, bedsAbove: beds, bedsDen: 0 as const, subType, price,
});
/** A home with a plus-room: `above` whole bedrooms plus a den / basement bedroom. */
const rDen = (above: number, subType: string | null, price: number) => ({
  beds: above + 1, bedsAbove: above, bedsDen: 1 as const, subType, price,
});

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
    expect(m!.bedCols).toEqual(["1", "2", "3"]);
    const condo = m!.rows.find((x) => x.label === "Condo Apartment")!;
    expect(condo.cells[0].median).toBe(2000); // 1 bd
    expect(condo.cells[1].median).toBe(2450); // 2 bd
    expect(condo.cells[2].median).toBeNull(); // no 3 bd condos
    const det = m!.rows.find((x) => x.label === "Detached")!;
    expect(det.cells[2].median).toBe(3500);
  });

  it("single-sample cells render their value WITH the count (owner call: 1 point beats a dash)", () => {
    const m = buildBedsTypeMatrix([
      r(2, "Condo Apartment", 2400),
      r(2, "Condo Apartment", 2500),
      r(3, "Condo Apartment", 2600),
      r(1, "Condo Apartment", 2000),
      r(1, "Condo Apartment", 2100),
    ]);
    const condo = m!.rows[0];
    const threeBd = condo.cells[m!.bedCols.indexOf("3")];
    expect(threeBd.median).toBe(2600);
    expect(threeBd.count).toBe(1);
  });

  it("keeps 4, 5 and 6+ bedrooms as separate columns; drops bedless/typeless/free rows", () => {
    const m = buildBedsTypeMatrix([
      r(4, "Detached", 4200),
      r(5, "Detached", 4800),
      r(7, "Detached", 5000),
      r(null, "Detached", 3000),
      r(3, null, 3000),
      r(3, "Detached", 0),
      r(2, "Condo Apartment", 2400),
      r(2, "Condo Apartment", 2500),
    ]);
    expect(m!.bedCols).toEqual(["2", "4", "5", "6"]); // 7 beds buckets into 6+
    const det = m!.rows.find((x) => x.label === "Detached")!;
    expect(det.cells[m!.bedCols.indexOf("4")].median).toBe(4200);
    expect(det.cells[m!.bedCols.indexOf("5")].median).toBe(4800);
    expect(det.cells[m!.bedCols.indexOf("6")].median).toBe(5000);
    expect(m!.sample).toBe(5);
  });

  it("beds 0 is a real Studio bucket (bachelor/basement rentals)", () => {
    const m = buildBedsTypeMatrix([
      r(0, "Detached", 1250),
      r(0, "Detached", 1300),
      r(2, "Detached", 1850),
    ]);
    expect(m!.bedCols).toEqual(["0", "2"]);
    expect(m!.rows[0].cells[0].median).toBe(1275);
  });

  it("returns null under the minimum sample so the panel self-hides", () => {
    expect(buildBedsTypeMatrix([r(2, "Condo Apartment", 2400), r(2, "Condo Apartment", 2500)])).toBeNull();
  });

  it("a grid of lone samples still renders (each cell carries its ×1 count)", () => {
    const m = buildBedsTypeMatrix([
      r(1, "A", 1000),
      r(2, "B", 2000),
      r(3, "C", 3000),
      r(4, "D", 4000),
      r(1, "E", 1500),
    ]);
    expect(m).not.toBeNull();
    expect(m!.sample).toBe(5);
    expect(m!.rows.every((row) => row.cells.some((c) => c.median !== null && c.count === 1))).toBe(true);
  });
});

describe("plus-room (\"+1\") columns — the den split", () => {
  it("keeps a 1+den OUT of the 2 bedroom column", () => {
    // Measured on Toronto condo apartments (24mo): the pooled "2 bed" lease cell was
    // 52.6% plus-den units, and the halves sit $500/mo apart. Merging them published
    // a number that described neither home.
    const m = buildBedsTypeMatrix([
      rDen(1, "Condo Apartment", 2450),
      rDen(1, "Condo Apartment", 2450),
      r(2, "Condo Apartment", 2950),
      r(2, "Condo Apartment", 2950),
    ])!;
    expect(m.bedCols).toEqual(["1+1", "2"]);
    const condo = m.rows.find((x) => x.label === "Condo Apartment")!;
    expect(condo.cells[m.bedCols.indexOf("1+1")].median).toBe(2450);
    expect(condo.cells[m.bedCols.indexOf("2")].median).toBe(2950);
  });

  it("orders each plus-room column beside its base, not at the end", () => {
    const m = buildBedsTypeMatrix([
      r(3, "Condo Apartment", 3700),
      rDen(2, "Condo Apartment", 3265),
      r(2, "Condo Apartment", 2950),
      rDen(1, "Condo Apartment", 2450),
      r(1, "Condo Apartment", 2200),
    ])!;
    expect(m.bedCols).toEqual(["1", "1+1", "2", "2+1", "3"]);
  });

  it("splits a studio+den off the 1 bedroom column", () => {
    const m = buildBedsTypeMatrix([
      rDen(0, "Condo Apartment", 1950),
      r(1, "Condo Apartment", 2200),
      r(1, "Condo Apartment", 2200),
    ])!;
    expect(m.bedCols).toEqual(["0+1", "1"]);
  });

  it("folds the plus-room into the capped 6+ column instead of emitting 6++1", () => {
    const m = buildBedsTypeMatrix([
      rDen(7, "Detached", 9000),
      r(7, "Detached", 9500),
      r(2, "Detached", 3000),
    ])!;
    expect(m.bedCols).toEqual(["2", "6"]);
    expect(m.bedCols.some((c) => c.includes("++"))).toBe(false);
  });

  it("SALE: collapses a thin +1 column back into its whole-bedroom column", () => {
    // Only 2 plus-room sales here — under SPLIT_MIN_N, and the backtest says a
    // 2-sale split median is worse than the merged one (19.18% vs 16.90%).
    const m = buildBedsTypeMatrix([
      rDen(2, "Condo Apartment", 900_000),
      rDen(2, "Condo Apartment", 910_000),
      r(3, "Condo Apartment", 700_000),
      r(3, "Condo Apartment", 700_000),
    ], { mode: "sale" })!;
    expect(m.bedCols).toEqual(["3"]);            // 2+1 folded into its total, 3
    const condo = m.rows.find((x) => x.label === "Condo Apartment")!;
    expect(condo.cells[0].count).toBe(4);
  });

  it("SALE: keeps the +1 column once it clears the floor", () => {
    const m = buildBedsTypeMatrix([
      ...[...Array(5)].map(() => rDen(2, "Condo Apartment", 900_000)),
      ...[...Array(3)].map(() => r(3, "Condo Apartment", 700_000)),
    ], { mode: "sale" })!;
    expect(m.bedCols).toEqual(["2+1", "3"]);
    const condo = m.rows.find((x) => x.label === "Condo Apartment")!;
    expect(condo.cells[m.bedCols.indexOf("2+1")].median).toBe(900_000);
    expect(condo.cells[m.bedCols.indexOf("3")].median).toBe(700_000);
  });

  it("RENT: never collapses — the split wins at every depth on leases", () => {
    // Lease backtest: split beat merged even on 1-2 samples (9.17% vs 11.32%).
    const m = buildBedsTypeMatrix([
      rDen(1, "Condo Apartment", 2450),
      r(2, "Condo Apartment", 2950),
      r(2, "Condo Apartment", 2950),
    ])!;
    expect(m.bedCols).toEqual(["1+1", "2"]);
  });

  it("splits houses too — a 4+1 is not a 5 bedroom", () => {
    // 37.1% of sold Detached carry a below-grade bedroom. Same arithmetic, and the
    // market quotes it "4+1" exactly like a condo den.
    const m = buildBedsTypeMatrix([
      ...[...Array(5)].map(() => rDen(4, "Detached", 1_200_000)),
      r(5, "Detached", 1_450_000),
      r(5, "Detached", 1_450_000),
    ], { mode: "sale" })!;
    expect(m.bedCols).toEqual(["4+1", "5"]);
    const det = m.rows.find((x) => x.label === "Detached")!;
    expect(det.cells[m.bedCols.indexOf("4+1")].median).toBe(1_200_000);
    expect(det.cells[m.bedCols.indexOf("5")].median).toBe(1_450_000);
  });

  it("drops a row with no above-grade count rather than banking it into a column", () => {
    const m = buildBedsTypeMatrix([
      { beds: 2, bedsAbove: null, bedsDen: 0 as const, subType: "Condo Apartment", price: 2600 },
      r(1, "Condo Apartment", 2200),
      r(1, "Condo Apartment", 2200),
      r(1, "Condo Apartment", 2200),
    ])!;
    expect(m.sample).toBe(3);
    expect(m.bedCols).toEqual(["1"]);
  });
});

describe("pickRentMatrix", () => {
  const m = (sample: number) => ({ bedCols: ["2"], rows: [{ label: "Detached", cells: [{ median: 3000, count: sample }], count: sample }], sample });

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

describe("isPartialUnitRental", () => {
  it("catches real feed phrasings for basement / in-home units", () => {
    // Every string below appeared verbatim in the live feed audits (2026-07-24).
    expect(isPartialUnitRental("41 Eberly Woods Drive Basement, Caledon, ON L7C 4J2")).toBe(true);
    expect(isPartialUnitRental("6 Sweet Briar Lane Bsmt, Brampton, ON L6Z 4V3")).toBe(true);
    expect(isPartialUnitRental("106 Benadir Avenue #bsmnt, Caledon, ON L7C 4E7")).toBe(true);
    expect(isPartialUnitRental("78 Burnett's Grove Circle B - Basement Unit, Barrhaven, ON")).toBe(true);
    expect(isPartialUnitRental("764 Botany Hill(Lower Unit) Crescent, Newmarket, ON")).toBe(true);
    expect(isPartialUnitRental("495 Bristol Road B (lower), Newmarket, ON")).toBe(true);
    expect(isPartialUnitRental("143 William Booth Avenue Basement, Newmarket, ON")).toBe(true);
    expect(isPartialUnitRental("1234 Bathurst St Upper, Toronto, ON")).toBe(true);
    expect(isPartialUnitRental("12 King St Main Floor, Toronto, ON")).toBe(true);
  });

  it("subtypes that ARE in-home units count regardless of address", () => {
    expect(isPartialUnitRental("10 Anywhere St, Whitby, ON", "Lower Level")).toBe(true);
    expect(isPartialUnitRental("10 Anywhere St, Whitby, ON", "Upper Level")).toBe(true);
  });

  it("never matches street NAMES containing lower/upper/main", () => {
    expect(isPartialUnitRental("15 Upper Canada Drive, Toronto, ON")).toBe(false);
    expect(isPartialUnitRental("126 Lower Base Line W, Milton, ON")).toBe(false);
    expect(isPartialUnitRental("22 Main Street S, Newmarket, ON")).toBe(false);
    expect(isPartialUnitRental("66 Beckett Avenue, East Gwillimbury, ON")).toBe(false);
  });

  it("routes in-home units to their own row so whole-home medians stay clean", () => {
    const m = buildBedsTypeMatrix([
      { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Detached", price: 3300, address: "134 Petch Avenue" },
      { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Detached", price: 3400, address: "45 Daisy Meadow Crescent" },
      { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Detached", price: 2000, address: "41 Eberly Woods Drive Basement" },
      { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Detached", price: 1700, address: "6 Sweet Briar Lane Bsmt" },
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Lower Level", price: 1950, address: "10 Anywhere St" },
    ]);
    const det = m!.rows.find((r) => r.label === "Detached")!;
    expect(det.cells[m!.bedCols.indexOf("3")].median).toBe(3350); // basements no longer drag it
    const inHome = m!.rows.find((r) => r.label === IN_HOME_UNIT_LABEL)!;
    expect(inHome.cells[m!.bedCols.indexOf("3")].median).toBe(1850);
    expect(inHome.cells[m!.bedCols.indexOf("2")].median).toBe(1950); // Lower Level folded in
  });
});

describe("outlier rules", () => {
  it("Rule A: trims points outside 0.5-2x of a well-sampled cell's median", () => {
    const m = buildBedsTypeMatrix([
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Condo Apartment", price: 2400, address: null },
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Condo Apartment", price: 2450, address: null },
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Condo Apartment", price: 2500, address: null },
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Condo Apartment", price: 9800, address: null }, // obvious outlier
    ]);
    const cell = m!.rows[0].cells[0];
    expect(cell.median).toBe(2450);
    expect(cell.count).toBe(3); // the 9800 was left out
  });

  it("Rule A: never trims tiny cells (under 4 points the median IS the data)", () => {
    const m = buildBedsTypeMatrix([
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Condo Apartment", price: 2400, address: null },
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Condo Apartment", price: 2450, address: null },
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Condo Apartment", price: 9800, address: null },
    ]);
    expect(m!.rows[0].cells[0].count).toBe(3);
  });

  it("Rule B: implausibly cheap low-bed HOUSE items reclassify as in-home units", () => {
    const m = buildBedsTypeMatrix([
      { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Detached", price: 2800, address: "1 A St" },
      { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Detached", price: 3000, address: "2 A St" },
      { beds: 4, bedsAbove: 4, bedsDen: 0 as const, subType: "Detached", price: 3000, address: "3 A St" },
      { beds: 1, bedsAbove: 1, bedsDen: 0 as const, subType: "Detached", price: 1350, address: "4 A St" }, // unmarked basement (45% of anchor)
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Detached", price: 1825, address: "5 A St" }, // unmarked basement (61%)
      { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Detached", price: 2400, address: "6 A St" }, // legit whole 2bd (80%) - stays
    ]);
    const det = m!.rows.find((r) => r.label === "Detached")!;
    expect(det.cells[m!.bedCols.indexOf("1")].count).toBe(0);
    expect(det.cells[m!.bedCols.indexOf("2")].median).toBe(2400);
    const inHome = m!.rows.find((r) => r.label === IN_HOME_UNIT_LABEL)!;
    expect(inHome.cells[m!.bedCols.indexOf("1")].median).toBe(1350);
    expect(inHome.cells[m!.bedCols.indexOf("2")].median).toBe(1825);
  });

  it("cells with 5+ kept points carry the middle-50% band; thinner cells stay median-only", () => {
    const m = buildBedsTypeMatrix([
      r(2, "Condo Apartment", 500_000),
      r(2, "Condo Apartment", 520_000),
      r(2, "Condo Apartment", 540_000),
      r(2, "Condo Apartment", 560_000),
      r(2, "Condo Apartment", 580_000),
      r(3, "Condo Apartment", 700_000),
      r(3, "Condo Apartment", 720_000),
      r(3, "Condo Apartment", 740_000),
    ]);
    const condo = m!.rows[0];
    const twoBd = condo.cells[m!.bedCols.indexOf("2")];
    expect(twoBd.median).toBe(540_000);
    expect(twoBd.p25).toBe(520_000);
    expect(twoBd.p75).toBe(560_000);
    const threeBd = condo.cells[m!.bedCols.indexOf("3")];
    expect(threeBd.median).toBe(720_000);
    expect(threeBd.p25).toBeNull();
    expect(threeBd.p75).toBeNull();
  });

  it("Rule A trims BEFORE the band is computed — an outlier can't stretch the range", () => {
    const m = buildBedsTypeMatrix([
      r(2, "Condo Apartment", 500_000),
      r(2, "Condo Apartment", 510_000),
      r(2, "Condo Apartment", 520_000),
      r(2, "Condo Apartment", 530_000),
      r(2, "Condo Apartment", 540_000),
      r(2, "Condo Apartment", 2_000_000), // trimmed by Rule A
    ]);
    const cell = m!.rows[0].cells[0];
    expect(cell.count).toBe(5);
    expect(cell.median).toBe(520_000);
    expect(cell.p25).toBe(510_000);
    expect(cell.p75).toBe(530_000);
  });

  it("sale mode: no basement classifier and no Rule B — a cheap 2bd detached is a bungalow, not a basement", () => {
    const m = buildBedsTypeMatrix(
      [
        { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Detached", price: 900_000, address: "1 A St" },
        { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Detached", price: 920_000, address: "2 A St" },
        { beds: 4, bedsAbove: 4, bedsDen: 0 as const, subType: "Detached", price: 950_000, address: "3 A St" },
        { beds: 2, bedsAbove: 2, bedsDen: 0 as const, subType: "Detached", price: 600_000, address: "4 A St" }, // 65% of anchor — stays put in sale mode
        { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Detached", price: 880_000, address: "41 Eberly Woods Drive Basement" }, // marker ignored in sale mode
      ],
      { mode: "sale" }
    );
    expect(m!.rows.find((x) => x.label === IN_HOME_UNIT_LABEL)).toBeUndefined();
    const det = m!.rows.find((x) => x.label === "Detached")!;
    expect(det.cells[m!.bedCols.indexOf("2")].median).toBe(600_000);
    expect(det.cells[m!.bedCols.indexOf("3")].count).toBe(3);
  });

  it("Rule B: condo rows are exempt (a cheap condo 1bd is normal) and rows without an anchor untouched", () => {
    const m = buildBedsTypeMatrix([
      { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Condo Apartment", price: 3000, address: null },
      { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Condo Apartment", price: 3100, address: null },
      { beds: 3, bedsAbove: 3, bedsDen: 0 as const, subType: "Condo Apartment", price: 3200, address: null },
      { beds: 1, bedsAbove: 1, bedsDen: 0 as const, subType: "Condo Apartment", price: 1800, address: null }, // 58% of anchor - stays put
    ]);
    const condo = m!.rows.find((r) => r.label === "Condo Apartment")!;
    expect(condo.cells[m!.bedCols.indexOf("1")].median).toBe(1800);
    expect(m!.rows.find((r) => r.label === IN_HOME_UNIT_LABEL)).toBeUndefined();
  });
});
