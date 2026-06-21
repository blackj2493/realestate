import { describe, it, expect } from "vitest";
import { normalizeDirectionFaces, DIRECTION_OPTIONS } from "./directionFaces";

describe("normalizeDirectionFaces", () => {
  it("maps full-word DirectionFaces (houses)", () => {
    expect(normalizeDirectionFaces({ DirectionFaces: "West" })).toBe("West");
    expect(normalizeDirectionFaces({ DirectionFaces: "South East" })).toBe("South East");
    expect(normalizeDirectionFaces({ DirectionFaces: "north-west" })).toBe("North West");
  });
  it("maps condo Exposure letter codes when DirectionFaces is absent", () => {
    expect(normalizeDirectionFaces({ Exposure: "Sw" })).toBe("South West");
    expect(normalizeDirectionFaces({ Exposure: "N" })).toBe("North");
  });
  it("prefers DirectionFaces over Exposure", () => {
    expect(normalizeDirectionFaces({ DirectionFaces: "East", Exposure: "W" })).toBe("East");
  });
  it("returns '' for dual / unknown / missing / wrong-type", () => {
    expect(normalizeDirectionFaces({ Exposure: "Ns" })).toBe(""); // dual through-unit
    expect(normalizeDirectionFaces({ DirectionFaces: "" })).toBe("");
    expect(normalizeDirectionFaces({ DirectionFaces: 5 })).toBe("");
    expect(normalizeDirectionFaces({})).toBe("");
    expect(normalizeDirectionFaces(null)).toBe("");
  });
  it("every option value round-trips through the normaliser", () => {
    for (const o of DIRECTION_OPTIONS) {
      expect(normalizeDirectionFaces({ DirectionFaces: o.value })).toBe(o.value);
    }
  });
});
