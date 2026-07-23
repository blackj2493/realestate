import { describe, it, expect } from "vitest";
import { localityMatch, fsaOf } from "./streetLedger";

describe("streetLedger locality matching", () => {
  it("regression: geocoder 'Nepean' matches feed 'Barrhaven' via FSA (Cappamore Drive, 2026-07-23)", () => {
    // The profile geocodes to city "Nepean" (K2J 6W3); the VOW feed files the same
    // street's sales under city "Barrhaven" (K2J 6V6). An exact city filter found 0
    // of the street's 10 recorded sales — FSA equality must accept them.
    expect(localityMatch("Nepean", fsaOf("K2J6W3"), "Barrhaven", "", fsaOf("K2J 6V6"))).toBe(true);
  });

  it("accepts exact city and city-prefix matches (Toronto districts, London directionals)", () => {
    expect(localityMatch("Nepean", null, "Nepean", "", null)).toBe(true);
    expect(localityMatch("Toronto", null, "Toronto C01", "", null)).toBe(true);
    expect(localityMatch("London", null, "London South", "", null)).toBe(true);
  });

  it("accepts shared Ottawa-group membership without an FSA", () => {
    expect(localityMatch("Ottawa", null, "Kanata", "", null)).toBe(true);
    expect(localityMatch("Barrhaven", null, "Kanata", "", null)).toBe(true);
  });

  it("rejects the same street name in a different market", () => {
    // "Main Street" exists everywhere — a Hamilton row must not enter an Ottawa ledger.
    expect(localityMatch("Nepean", fsaOf("K2J6W3"), "Hamilton", "", fsaOf("L8P 1A1"))).toBe(false);
    expect(localityMatch("Nepean", null, "Hamilton", "", null)).toBe(false);
  });

  it("fsaOf normalizes and rejects junk", () => {
    expect(fsaOf("K2J 6W3")).toBe("K2J");
    expect(fsaOf("k2j6w3")).toBe("K2J");
    expect(fsaOf("12345")).toBeNull();
    expect(fsaOf(null)).toBeNull();
  });
});
