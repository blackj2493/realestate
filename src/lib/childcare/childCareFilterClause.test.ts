import { describe, it, expect } from "vitest";
import { childCareFilterClause, formatChildCareKm } from "./childCareFilterClause";

describe("childCareFilterClause", () => {
  it("is null when the tool is off", () => {
    expect(childCareFilterClause({ enabled: false, kind: "infant", maxKm: 1 })).toBeNull();
  });

  it("maps each kind to its field", () => {
    expect(childCareFilterClause({ enabled: true, kind: "infant", maxKm: 1 })).toBe("NearestInfantCareKm:<=1");
    expect(childCareFilterClause({ enabled: true, kind: "any", maxKm: 0.5 })).toBe("NearestChildCareKm:<=0.5");
    expect(childCareFilterClause({ enabled: true, kind: "cwelcc", maxKm: 2 })).toBe("NearestCwelccKm:<=2");
  });

  it("falls back to any licensed centre for an unknown kind (e.g. an old saved state)", () => {
    expect(childCareFilterClause({ enabled: true, kind: "bogus" as never, maxKm: 1 })).toBe("NearestChildCareKm:<=1");
  });

  it("is null for a nonsense distance", () => {
    expect(childCareFilterClause({ enabled: true, kind: "any", maxKm: 0 })).toBeNull();
    expect(childCareFilterClause({ enabled: true, kind: "any", maxKm: NaN })).toBeNull();
  });
});

describe("formatChildCareKm", () => {
  it("prints metres under 1 km", () => {
    expect(formatChildCareKm(0.5)).toBe("500m");
    expect(formatChildCareKm(1)).toBe("1km");
    expect(formatChildCareKm(2)).toBe("2km");
  });
});
