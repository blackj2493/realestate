import { describe, it, expect } from "vitest";
import { normalizeConfig, DEFAULT_ACTIVITY_LENS, DEFAULT_PERSONA } from "./config";
import { DEFAULT_BOARD_ORDER } from "./boards";

describe("normalizeConfig (shared by localStorage + dashboard_prefs jsonb)", () => {
  it("junk in → full default config out (server blob can never crash the dashboard)", () => {
    for (const junk of [null, undefined, 42, "x", [], { regions: "nope", boards: 7 }]) {
      const c = normalizeConfig(junk);
      expect(c.regions).toEqual([]);
      expect(c.boards).toEqual([...DEFAULT_BOARD_ORDER]);
      expect(c.marketActivity).toEqual(DEFAULT_ACTIVITY_LENS);
      expect(c.persona).toBe(DEFAULT_PERSONA);
      expect(c.lastVisitAt).toBeNull();
    }
  });

  it("valid fields survive; partial lens merges onto defaults", () => {
    const c = normalizeConfig({
      regions: ["Ottawa", "Barrhaven"],
      marketActivity: { windowDays: 30, minBeds: 3, propertyTypes: ["detached"] },
      persona: "cashflow",
      lastVisitAt: 1753300000000,
    });
    expect(c.regions).toEqual(["Ottawa", "Barrhaven"]);
    expect(c.marketActivity.windowDays).toBe(30);
    expect(c.marketActivity.minBeds).toBe(3);
    expect(c.marketActivity.basement).toBe("any"); // unspecified → default
    expect(c.persona).toBe("cashflow");
    expect(c.lastVisitAt).toBe(1753300000000);
  });

  it("legacy basementFinished upgrades to the tri-state", () => {
    const c = normalizeConfig({ marketActivity: { basementFinished: true } });
    expect(c.marketActivity.basement).toBe("finished");
  });

  // A retired board ('fresh') has to leave the stored config, not just the render —
  // this object round-trips through dashboard_prefs and would carry the dead id for
  // years otherwise.
  it("drops a retired board id and keeps the user's remaining picks", () => {
    const c = normalizeConfig({ boards: ["cap_rate", "fresh", "carry"] });
    expect(c.boards).toEqual(["cap_rate", "carry"]);
  });

  it("falls back to the defaults when every stored board is retired", () => {
    const c = normalizeConfig({ boards: ["fresh"] });
    expect(c.boards).toEqual([...DEFAULT_BOARD_ORDER]);
  });

  it("leaves a valid board set untouched, order included", () => {
    const c = normalizeConfig({ boards: ["carry", "cap_rate"] });
    expect(c.boards).toEqual(["carry", "cap_rate"]);
  });
});
