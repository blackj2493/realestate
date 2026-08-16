import { describe, expect, it } from "vitest";
import { slugToStreetText } from "./addressSlug";
import { parseAddress } from "@/lib/watchlist/disposition";

/**
 * A slug flattens every hyphen to a space, which destroys the one separator that marks
 * a unit. Live defect: /address/on/mississauga/86-2945-thomas-street resolved to civic
 * number 86 on a street named "2945 Thomas Street" — an address that exists nowhere, so
 * the page matched nothing and never learned it was about unit 86.
 */
describe("slugToStreetText", () => {
  it("restores the unit hyphen for a unit-first slug", () => {
    expect(slugToStreetText("86-2945-thomas-street")).toBe("86-2945 thomas street");
  });

  it("feeds parseAddress the right civic number and unit", () => {
    const p = parseAddress(`${slugToStreetText("86-2945-thomas-street")}, mississauga`);
    expect(p.streetNumber).toBe("2945"); // the STREET number
    expect(p.unit).toBe("86");
    expect(p.streetName).toBe("thomas street");
  });

  it("leaves a plain address slug alone", () => {
    expect(slugToStreetText("142-maplewood-avenue")).toBe("142 maplewood avenue");
    expect(parseAddress(`${slugToStreetText("142-maplewood-avenue")}, vaughan`).unit).toBe("");
    expect(parseAddress(`${slugToStreetText("142-maplewood-avenue")}, vaughan`).streetNumber).toBe("142");
  });

  it("leaves a unit-less numeric street slug alone", () => {
    // "2945-thomas-street" has ONE leading number — not a unit pair.
    expect(slugToStreetText("2945-thomas-street")).toBe("2945 thomas street");
    expect(parseAddress(`${slugToStreetText("2945-thomas-street")}, mississauga`).unit).toBe("");
  });

  it("handles a letter-suffixed unit", () => {
    const p = parseAddress(`${slugToStreetText("12a-100-elm-avenue")}, toronto`);
    expect(p.unit).toBe("12a");
    expect(p.streetNumber).toBe("100");
  });

  it("does not fire on a numbered road", () => {
    // "1234-highway-7" → one leading number, then a word. Untouched.
    expect(slugToStreetText("1234-highway-7")).toBe("1234 highway 7");
    expect(parseAddress(`${slugToStreetText("1234-highway-7")}, vaughan`).unit).toBe("");
  });
});
