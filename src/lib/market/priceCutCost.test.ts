import { describe, expect, it } from "vitest";
import { parseAsk, parseCutRows, soldFor, visibleGroups, type CutGroup } from "./priceCutCost";

const g = (bucket: CutGroup["bucket"], sales: number, pct = 90): CutGroup => ({
  bucket,
  sales,
  pctOfFirstAsk: pct,
  medianDom: 30,
  medianFirstAsk: 1_000_000,
});

describe("visibleGroups", () => {
  it("shows four groups when both deep groups are big enough", () => {
    const v = visibleGroups([g("none", 400), g("under5", 40), g("5to10", 25), g("over10", 21), g("5plus", 46)]);
    expect(v.map((x) => x.bucket)).toEqual(["none", "under5", "5to10", "over10"]);
  });

  it("joins the deep cuts into 5% or more when one of them is small", () => {
    const v = visibleGroups([g("none", 385), g("under5", 35), g("5to10", 20), g("over10", 8), g("5plus", 28)]);
    expect(v.map((x) => x.bucket)).toEqual(["none", "under5", "5plus"]);
  });

  it("hides everything without a big enough no-cut baseline", () => {
    expect(visibleGroups([g("none", 19), g("under5", 40), g("5plus", 40)])).toEqual([]);
  });

  it("hides a baseline that has nothing to compare with", () => {
    expect(visibleGroups([g("none", 300), g("under5", 5), g("5plus", 9)])).toEqual([]);
  });
});

describe("parseCutRows", () => {
  it("reads numeric strings and drops unknown buckets", () => {
    const rows = parseCutRows([
      { bucket: "none", sales: 10, pct_of_first_ask: "97.0", median_dom: 19, median_first_ask: 1300000 },
      { bucket: "weird", sales: 3, pct_of_first_ask: "90" },
      { bucket: "under5", sales: 4, pct_of_first_ask: null },
    ]);
    expect(rows).toEqual([
      { bucket: "none", sales: 10, pctOfFirstAsk: 97, medianDom: 19, medianFirstAsk: 1300000 },
    ]);
  });
});

describe("soldFor / parseAsk", () => {
  it("rounds to the nearest $1,000", () => {
    expect(soldFor(1_300_000, 97.0)).toBe(1_261_000);
    expect(soldFor(1_300_000, 89.0)).toBe(1_157_000);
  });

  it("reads common ways to type a price", () => {
    expect(parseAsk("$1,300,000")).toBe(1_300_000);
    expect(parseAsk("1.3m")).toBe(1_300_000);
    expect(parseAsk("950k")).toBe(950_000);
    expect(parseAsk("12")).toBeNull();
    expect(parseAsk("abc")).toBeNull();
  });
});
