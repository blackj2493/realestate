import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET, type ChildCareResponse } from "./route";

async function call(lat: number | string, lng: number | string): Promise<ChildCareResponse> {
  const res = await GET(new NextRequest(`http://localhost/api/childcare/nearby?lat=${lat}&lng=${lng}`));
  return (await res.json()) as ChildCareResponse;
}

describe("GET /api/childcare/nearby", () => {
  it("answers from the City of Toronto data inside Toronto", async () => {
    const r = await call(43.6532, -79.3832);
    expect(r.covered).toBe(true);
    if (!r.covered || r.scope !== "toronto") throw new Error("expected the Toronto scope");
    expect(r.neighbourhood).not.toBeNull();
    expect(typeof r.infantSpaces).toBe("number");
    expect(typeof r.cwelccCount).toBe("number");
  });

  it("answers from the Ontario list elsewhere in Ontario", async () => {
    const r = await call(45.42, -75.69); // downtown Ottawa
    if (!r.covered || r.scope !== "ontario") throw new Error("expected the Ontario scope");
    expect(r.radiusKm).toBe(1);
    expect(r.count).toBeGreaterThan(0);
    expect(r.fullDayCount).toBeLessThanOrEqual(r.count);
    expect(Object.keys(r.centres[0]).sort()).toEqual(["city", "distanceKm", "fullDay", "id", "name"]);
    expect(r).not.toHaveProperty("neighbourhood");
  });

  it("is not covered far from any Ontario centre or with bad input", async () => {
    expect(await call(49.28, -123.12)).toEqual({ covered: false }); // Vancouver
    expect(await call("x", "y")).toEqual({ covered: false });
  });
});
