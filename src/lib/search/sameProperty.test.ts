import { describe, it, expect } from "vitest";
import { isSameProperty } from "./sameProperty";

// This predicate decides both where an off-market row NAVIGATES and which campaigns fold
// into one home. Too loose and a visitor lands on someone else's house; too strict and a
// relisted home splits back into rows that look like separate properties.
describe("isSameProperty", () => {
  it("joins a terminated campaign to its relist at the same address", () => {
    expect(
      isSameProperty("90 Osler Drive, Hamilton, ON L9H 4B5", "90 Osler Drive, Hamilton, ON L9H 4B5")
    ).toBe(true);
  });

  it("tolerates a suffix abbreviation", () => {
    expect(isSameProperty("90 Osler Dr, Hamilton, ON L9H 4B5", "90 Osler Drive, Hamilton, ON L9H 4B5")).toBe(true);
  });

  it("matches on city when neither address carries a postal", () => {
    expect(isSameProperty("90 Osler Drive, Hamilton", "90 Osler Dr, Hamilton")).toBe(true);
  });

  it("separates the same street name in another city", () => {
    // Both real: 90 Osler Drive in Hamilton and 90 OSLER Street in Kanata.
    expect(
      isSameProperty("90 Osler Drive, Hamilton, ON L9H 4B5", "90 OSLER Street, Kanata, ON K2W 0K8")
    ).toBe(false);
  });

  it("separates different civic numbers on one street", () => {
    expect(
      isSameProperty("839 Cappamore Drive, Barrhaven, ON K2J 7C3", "800 Cappamore Drive, Barrhaven, ON K2J 6V6")
    ).toBe(false);
  });

  it("checks the street even when postals collide", () => {
    // addressesMatch would accept this on postal equality alone.
    expect(
      isSameProperty("90 Osler Drive, Hamilton, ON L9H 4B5", "90 Coldstream Drive, Hamilton, ON L9H 4B5")
    ).toBe(false);
  });

  it("refuses to guess from an unusable address", () => {
    expect(isSameProperty("Hamilton", "Hamilton")).toBe(false);
    expect(isSameProperty(null, "90 Osler Drive, Hamilton")).toBe(false);
    expect(isSameProperty(undefined, undefined)).toBe(false);
  });
});
