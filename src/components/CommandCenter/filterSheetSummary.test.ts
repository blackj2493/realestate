import { describe, expect, it } from "vitest";
import { activeLabels, summarise } from "./filterSheetSummary";
import type { FilterDef } from "@/lib/filters/types";

const def = (key: string, label: string): FilterDef => ({
  key,
  label,
  category: "Property",
  control: "enum",
  defaultPinned: false,
  defaultValue: [],
  isActive: (v) => Array.isArray(v) && v.length > 0,
  buildClause: () => null,
  chipLabel: (v) => `${label}: ${(v as string[]).join("/")}`,
});

describe("activeLabels", () => {
  it("keeps only the active items, in order, and survives a bad value", () => {
    const broken: FilterDef = { ...def("x", "X"), isActive: () => { throw new Error("bad"); } };
    expect(
      activeLabels([
        { def: def("a", "A"), value: ["1"] },
        { def: def("b", "B"), value: [] },
        { def: broken, value: ["?"] },
        { def: def("c", "C"), value: ["2"] },
      ])
    ).toEqual(["A: 1", "C: 2"]);
  });
});

describe("summarise", () => {
  it("states what is set, capped at two plus a count", () => {
    expect(summarise(["3+ bd", "2+ ba", "Detached"], "Any")).toEqual({
      text: "3+ bd · 2+ ba · +1",
      active: true,
      count: 3,
    });
  });

  it("falls back to what the section offers when nothing is set", () => {
    expect(summarise([], "Size, basement, lot…")).toEqual({ text: "Size, basement, lot…", active: false, count: 0 });
  });
});
