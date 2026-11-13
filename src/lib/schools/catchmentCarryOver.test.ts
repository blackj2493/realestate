import { describe, expect, it } from "vitest";
import { carryCatchments, parseCatchmentExport } from "./catchmentCarryOver";

describe("parseCatchmentExport", () => {
  it("reads id → tokens and skips docs without the field or bad lines", () => {
    const m = parseCatchmentExport(
      ['{"id":"A","SchoolCatchments":["s1|regular"]}', '{"id":"B"}', "not json", '{"id":"C","SchoolCatchments":[]}', ""].join("\n")
    );
    expect([...m.entries()]).toEqual([
      ["A", ["s1|regular"]],
      ["C", []],
    ]);
  });
});

describe("carryCatchments", () => {
  it("fills only the docs that lack the field, including a stored []", () => {
    const docs: Array<Record<string, unknown>> = [
      { id: "A" },
      { id: "B", SchoolCatchments: ["new|regular"] },
      { id: "C" },
      { id: "D" },
    ];
    const stored = new Map([
      ["A", ["s1|regular"]],
      ["B", ["old|regular"]],
      ["C", []],
    ]);
    expect(carryCatchments(docs, stored)).toBe(2);
    expect(docs.map((d) => d.SchoolCatchments)).toEqual([["s1|regular"], ["new|regular"], [], undefined]);
  });
});
