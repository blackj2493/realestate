import { describe, it, expect } from "vitest";
import { ageGroupsLabel, centreHover } from "./useChildCareCentreLayers";

describe("child care pin tooltip", () => {
  it("lists Toronto age groups with spaces", () => {
    expect(ageGroupsLabel({ infant: 10, toddler: 0, preschool: 24 })).toBe("Infant 10 · Preschool 24");
    expect(
      centreHover({ detail: true, id: 1, name: "A", infant: 0, toddler: 5, preschool: 0, cwelcc: true })
    ).toEqual({ name: "A", ages: "Toddler 5", cwelcc: true, detail: true });
  });

  it("shows an Ontario centre as a licensed centre with full or half day, never $10-a-day", () => {
    expect(centreHover({ detail: false, id: "0001", name: "B", fullDay: true })).toEqual({
      name: "B",
      ages: "Licensed centre · Full day",
      cwelcc: false,
      detail: false,
    });
    expect(centreHover({ detail: false, id: "0002", name: "C", fullDay: false }).ages).toBe("Licensed centre · Half day");
  });
});
