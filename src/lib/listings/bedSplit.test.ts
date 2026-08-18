import { describe, it, expect } from "vitest";
import { bedSplit, bedKey, bedKeyOrder, bedKeyLabel, parseBedKey } from "./bedSplit";

describe("bedSplit — the shapes the feed actually ships", () => {
  it("splits a plain 2 bedroom", () => {
    const s = bedSplit({ BedroomsAboveGrade: 2, BedroomsBelowGrade: 0, BedroomsTotal: 2 })!;
    expect(s).toMatchObject({ above: 2, below: 0, den: 0, denKnown: true });
    expect(bedKey(s)).toBe("2");
  });

  it("splits a 1+den OUT of the 2 bedroom bucket — the whole point", () => {
    const s = bedSplit({ BedroomsAboveGrade: 1, BedroomsBelowGrade: 1, BedroomsTotal: 2 })!;
    expect(s).toMatchObject({ above: 1, below: 1, den: 1 });
    expect(bedKey(s)).toBe("1+1");
  });

  it("splits a 2+den OUT of the 3 bedroom bucket", () => {
    const s = bedSplit({ BedroomsAboveGrade: 2, BedroomsBelowGrade: 1, BedroomsTotal: 3 })!;
    expect(bedKey(s)).toBe("2+1");
  });

  it("keeps a true studio as its own bucket", () => {
    const s = bedSplit({ BedroomsAboveGrade: 0, BedroomsBelowGrade: 0, BedroomsTotal: 0 })!;
    expect(bedKey(s)).toBe("0");
  });

  it("handles studio+den (755 have sold)", () => {
    const s = bedSplit({ BedroomsAboveGrade: 0, BedroomsBelowGrade: 1, BedroomsTotal: 1 })!;
    expect(s).toMatchObject({ above: 0, below: 1, den: 1 });
    expect(bedKey(s)).toBe("0+1");
  });

  it("caps two plus-rooms into the +1 column but keeps the raw count for the AVM", () => {
    const s = bedSplit({ BedroomsAboveGrade: 2, BedroomsBelowGrade: 2, BedroomsTotal: 4 })!;
    expect(s.below).toBe(2);
    expect(s.den).toBe(1);
    expect(bedKey(s)).toBe("2+1");
  });

  it("caps above-grade beds at 6", () => {
    const s = bedSplit({ BedroomsAboveGrade: 9, BedroomsBelowGrade: 0, BedroomsTotal: 9 })!;
    expect(bedKey(s)).toBe("6");
  });
});

describe("bedSplit — recovery and missing data", () => {
  it("recovers above-grade when TRREB ships it empty and the total carries the sum", () => {
    // A 4+1 arriving as {above: empty, below: 1, total: 5}. bedsLabel renders this
    // "5+1" today, which invents a bedroom. We classify it as 4+1.
    const s = bedSplit({ BedroomsAboveGrade: null, BedroomsBelowGrade: 1, BedroomsTotal: 5 })!;
    expect(s).toMatchObject({ above: 4, below: 1, den: 1 });
    expect(bedKey(s)).toBe("4+1");
  });

  it("takes the total as-is when there is nothing to subtract", () => {
    const s = bedSplit({ BedroomsAboveGrade: null, BedroomsBelowGrade: null, BedroomsTotal: 3 })!;
    expect(s).toMatchObject({ above: 3, below: 0, den: 0 });
  });

  it("never produces a negative above-grade count", () => {
    const s = bedSplit({ BedroomsAboveGrade: 0, BedroomsBelowGrade: 3, BedroomsTotal: 2 })!;
    expect(s.above).toBeGreaterThanOrEqual(0);
  });

  it("flags an ABSENT below-grade field as unknown, not as zero", () => {
    const s = bedSplit({ BedroomsAboveGrade: 2, BedroomsTotal: 2 })!;
    expect(s).toMatchObject({ den: 0, denKnown: false });
  });

  it("flags an EXPLICIT zero as known", () => {
    const s = bedSplit({ BedroomsAboveGrade: 2, BedroomsBelowGrade: 0, BedroomsTotal: 2 })!;
    expect(s.denKnown).toBe(true);
  });

  it("returns null when there is no bed data at all", () => {
    expect(bedSplit({})).toBeNull();
    expect(bedSplit({ BedroomsAboveGrade: null, BedroomsBelowGrade: null, BedroomsTotal: null })).toBeNull();
  });

  it("still classifies a row whose only bed field is an explicit zero", () => {
    expect(bedSplit({ BedroomsTotal: 0 })).not.toBeNull();
  });

  it("truncates fractional counts and floors negatives", () => {
    const s = bedSplit({ BedroomsAboveGrade: 2.7, BedroomsBelowGrade: -1, BedroomsTotal: 3 })!;
    expect(s).toMatchObject({ above: 2, below: 0 });
  });
});

describe("column key helpers", () => {
  it("orders columns 0, 0+1, 1, 1+1, 2, 2+1", () => {
    const keys = ["2+1", "0", "1", "2", "0+1", "1+1"];
    expect(keys.sort((a, b) => bedKeyOrder(a) - bedKeyOrder(b))).toEqual(["0", "0+1", "1", "1+1", "2", "2+1"]);
  });

  it("round-trips a key", () => {
    expect(parseBedKey("2+1")).toEqual({ above: 2, den: 1 });
    expect(parseBedKey("3")).toEqual({ above: 3, den: 0 });
  });

  it("labels each column the way the market quotes it", () => {
    expect(bedKeyLabel("0")).toBe("Studio");
    expect(bedKeyLabel("0+1")).toBe("Studio+1");
    expect(bedKeyLabel("1")).toBe("1 bd");
    expect(bedKeyLabel("2+1")).toBe("2+1 bd");
    expect(bedKeyLabel("6")).toBe("6+ bd");
    expect(bedKeyLabel("6+1")).toBe("6+ bd"); // capped bucket folds the plus-room
  });
});

describe("the cap folds the plus-room", () => {
  it("does not emit a 6+1 column", () => {
    const s = bedSplit({ BedroomsAboveGrade: 7, BedroomsBelowGrade: 1, BedroomsTotal: 8 })!;
    expect(bedKey(s)).toBe("6");
    expect(bedKeyLabel(bedKey(s))).toBe("6+ bd");
  });
});
