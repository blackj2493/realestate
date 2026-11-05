import { describe, expect, it } from "vitest";
import { assignDas, communityKey, mode } from "./communities";

const row = (dauid: string, community: string, n: number, city = "Toronto C02") => ({ dauid, city, community, n });

describe("assignDas", () => {
  it("gives each DA to the community with most of its points", () => {
    const out = assignDas([
      row("1", "Annex", 8),
      row("1", "Casa Loma", 2),
      row("2", "Annex", 5),
      row("3", "Casa Loma", 4),
      row("4", "Casa Loma", 9),
    ]);
    expect(out.get(communityKey("Toronto C02", "Annex"))).toEqual(["1", "2"]);
    expect(out.get(communityKey("Toronto C02", "Casa Loma"))).toEqual(["3", "4"]);
  });

  it("drops a split DA, a DA with too few points, and a tie", () => {
    const out = assignDas([
      row("1", "Annex", 4),
      row("1", "Casa Loma", 3),
      row("1", "Wychwood", 3), // Annex holds 40%: split
      row("2", "Annex", 2), // 2 points: too few
      row("3", "Annex", 3),
      row("3", "Casa Loma", 3), // tie
      row("4", "Annex", 5),
      row("5", "Annex", 5),
    ]);
    expect(out.get(communityKey("Toronto C02", "Annex"))).toEqual(["4", "5"]);
    expect(out.has(communityKey("Toronto C02", "Casa Loma"))).toBe(false);
  });

  it("keeps the same community name in two cities apart, and drops a 1-DA community", () => {
    const out = assignDas([row("1", "Downtown", 5, "Oakville"), row("2", "Downtown", 5, "Oakville"), row("3", "Downtown", 5, "Barrie")]);
    expect(out.get(communityKey("Oakville", "Downtown"))).toEqual(["1", "2"]);
    expect(out.has(communityKey("Barrie", "Downtown"))).toBe(false);
  });
});

describe("mode", () => {
  it("returns the most common value, first seen on a tie", () => {
    expect(mode(["a", "b", "b"])).toBe("b");
    expect(mode(["a", "b"])).toBe("a");
    expect(mode([])).toBeNull();
  });
});
