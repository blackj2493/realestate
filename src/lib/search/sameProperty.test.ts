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

  // The regression #320 fixed elsewhere: every unit in a condo block shares one civic
  // number and one postal code. Ignoring the unit here would fold one unit's campaign
  // history under another and forward a visitor to the neighbour's live listing.
  it("keeps two units in one condo block apart", () => {
    expect(
      isSameProperty("86 - 2945 Thomas Street, Mississauga, ON L5M 0P8", "62 - 2945 Thomas Street, Mississauga, ON L5M 0P8")
    ).toBe(false);
    expect(
      isSameProperty("2945 Thomas Street #86, Mississauga, ON", "2945 Thomas Street #62, Mississauga, ON")
    ).toBe(false);
  });

  it("still joins the same unit's own campaigns", () => {
    expect(
      isSameProperty("86 - 2945 Thomas Street, Mississauga, ON L5M 0P8", "86 - 2945 Thomas St, Mississauga, ON L5M 0P8")
    ).toBe(true);
  });

  it("refuses to guess from an unusable address", () => {
    expect(isSameProperty("Hamilton", "Hamilton")).toBe(false);
    expect(isSameProperty(null, "90 Osler Drive, Hamilton")).toBe(false);
    expect(isSameProperty(undefined, undefined)).toBe(false);
  });
});

// ── Grouping ────────────────────────────────────────────────────────────────
// The header bar shipped without this and rendered a relisted home as three flat
// siblings — dead campaign FIRST, live listing last, nothing saying they were one
// house. Both bars now group through here.
import { groupByProperty } from "./sameProperty";

const row = (id: string, address: string) => ({ id, address });
const addr = (r: { address: string }) => r.address;

describe("groupByProperty", () => {
  it("folds later campaigns under the first row for an address", () => {
    const groups = groupByProperty(
      [
        row("X13585448", "90 Osler Drive, Hamilton, ON L9H 4B5"), // live — caller puts it first
        row("X12888728", "90 Osler Drive, Hamilton, ON L9H 4B5"), // terminated
        row("X12941486", "90 OSLER Street, Kanata, ON K2W 0K8"), // unrelated home
      ],
      addr
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].lead.id).toBe("X13585448");
    expect(groups[0].history.map((h) => h.id)).toEqual(["X12888728"]);
    expect(groups[1].lead.id).toBe("X12941486");
    expect(groups[1].history).toEqual([]);
  });

  it("respects caller order — whichever row comes first leads", () => {
    const groups = groupByProperty(
      [
        row("X12888728", "90 Osler Drive, Hamilton, ON L9H 4B5"),
        row("X13585448", "90 Osler Drive, Hamilton, ON L9H 4B5"),
      ],
      addr
    );
    expect(groups[0].lead.id).toBe("X12888728");
  });

  it("never folds two units of one condo block together", () => {
    const groups = groupByProperty(
      [
        row("A", "86 - 2945 Thomas Street, Mississauga, ON L5M 0P8"),
        row("B", "62 - 2945 Thomas Street, Mississauga, ON L5M 0P8"),
      ],
      addr
    );
    expect(groups).toHaveLength(2);
  });

  it("leaves rows with no usable address ungrouped", () => {
    const groups = groupByProperty([row("A", "Hamilton"), row("B", "Hamilton")], addr);
    expect(groups).toHaveLength(2);
  });
});
