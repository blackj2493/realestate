import { describe, it, expect } from "vitest";
import { basementLabel } from "./basementLabel";

describe("basementLabel", () => {
  it("joins multiple TRREB basement tokens with the data-sheet separator", () => {
    expect(basementLabel({ Basement: ["Finished", "Walk-Out"] })).toBe("Finished · Walk-Out");
    expect(basementLabel({ Basement: ["Part Fin", "Sep Entrance"] })).toBe("Part Fin · Sep Entrance");
  });

  it("renders a single token unchanged", () => {
    expect(basementLabel({ Basement: ["Apartment"] })).toBe("Apartment");
    expect(basementLabel({ Basement: "Unfinished" })).toBe("Unfinished");
  });

  it("trims whitespace and drops empty tokens", () => {
    expect(basementLabel({ Basement: [" Finished ", "", "  "] })).toBe("Finished");
  });

  it("returns 'None' when basement data is missing (e.g. condos)", () => {
    expect(basementLabel({})).toBe("None");
    expect(basementLabel({ Basement: [] })).toBe("None");
    expect(basementLabel({ Basement: "" })).toBe("None");
    expect(basementLabel({ Basement: null })).toBe("None");
  });

  it("reads the Typesense index field (BasementType) when Basement is absent", () => {
    // Command Center cards / Quick Look are fed a ListingDocument, whose
    // basement lives in `BasementType` rather than the VOW `Basement`.
    expect(basementLabel({ BasementType: ["Finished", "Walk-Out"] })).toBe("Finished · Walk-Out");
    expect(basementLabel({ BasementType: [] })).toBe("None");
  });

  it("prefers Basement over BasementType, falling back only when it is empty", () => {
    expect(basementLabel({ Basement: ["Apartment"], BasementType: ["Finished"] })).toBe("Apartment");
    expect(basementLabel({ Basement: [], BasementType: ["Finished"] })).toBe("Finished");
  });
});
