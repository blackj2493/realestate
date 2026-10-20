import { describe, expect, it } from "vitest";
import { boundaryNote } from "./boundaryNotes";

describe("boundaryNote", () => {
  it("notes a zone the board's file is known to lag", () => {
    expect(boundaryNote("Toronto DSB", "John Fisher Junior Public School")).toMatch(/TDSB school locator/);
  });

  it("matches the board exactly, so the Catholic board's same-named school gets no note", () => {
    expect(boundaryNote("Toronto Catholic DSB", "John Fisher Junior Public School")).toBeNull();
  });

  it("returns null for any other zone or a missing name", () => {
    expect(boundaryNote("Toronto DSB", "Bedford Park Public School")).toBeNull();
    expect(boundaryNote(null, "John Fisher Junior Public School")).toBeNull();
  });
});
