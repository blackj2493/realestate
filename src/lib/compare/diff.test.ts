import { describe, it, expect } from "vitest";
import { rowIsIdentical } from "./diff";

describe("rowIsIdentical", () => {
  it("true when all present displayed values match", () => {
    expect(rowIsIdentical(["$3,200/mo", "$3,200/mo", "$3,200/mo"])).toBe(true);
  });
  it("false when any displayed value differs", () => {
    expect(rowIsIdentical(["Condo", "Condo", "Detached"])).toBe(false);
  });
  it("treats fewer than 2 present values as identical", () => {
    expect(rowIsIdentical(["Detached", null, null])).toBe(true);
    expect(rowIsIdentical([null, "", undefined])).toBe(true);
  });
  it("ignores null/empty when comparing", () => {
    expect(rowIsIdentical(["5", null, "5", ""])).toBe(true);
  });
});
