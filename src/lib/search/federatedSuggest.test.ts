import { describe, it, expect } from "vitest";
import { matchesTypedAddress } from "./federatedSuggest";

// The regression this guards: Typesense typo-tolerance returns "758 Coldstream Drive"
// for "758 cappamore drive", and those fuzzy hits used to suppress the geocode fallback
// entirely — a real off-market address never surfaced in the suggest dropdown.
describe("matchesTypedAddress", () => {
  it("accepts the same address in different formats", () => {
    expect(matchesTypedAddress("758 cappamore drive", "758 Cappamore Drive, Ottawa, ON K2J 6L4")).toBe(true);
    expect(matchesTypedAddress("40 rampart dr", "40 Rampart Drive, Brampton, ON")).toBe(true);
  });

  it("rejects a typo-tolerant fuzzy lookalike (different street)", () => {
    expect(matchesTypedAddress("758 cappamore drive", "758 Coldstream Drive, Oshawa, ON L1K 2K4")).toBe(false);
    expect(matchesTypedAddress("758 cappamore drive", "758 Dovercourt Road 1102, Toronto, ON")).toBe(false);
  });

  it("rejects a different civic number on the same street", () => {
    expect(matchesTypedAddress("758 cappamore drive", "760 Cappamore Drive, Ottawa, ON")).toBe(false);
  });

  it("requires a real street name in the typed query (no mid-typing matches)", () => {
    expect(matchesTypedAddress("758", "758 Coldstream Drive")).toBe(false);
    expect(matchesTypedAddress("758 ca", "758 Cappamore Drive")).toBe(false);
  });

  it("handles suffix variants (Dr vs Drive)", () => {
    expect(matchesTypedAddress("758 cappamore dr", "758 Cappamore Drive, Ottawa, ON")).toBe(true);
  });
});
