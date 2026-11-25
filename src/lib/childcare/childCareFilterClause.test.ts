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
