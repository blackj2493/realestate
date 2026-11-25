import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildCentresGeoJson } from "./centresGeoJson";
import type { ChildCareFile } from "./torontoChildCare";

describe("buildCentresGeoJson", () => {
  it("emits one [lng, lat] point per centre with under-school-age spaces with the compact props", () => {
    const file = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "toronto-child-care.json"), "utf-8")
    ) as ChildCareFile;
    const fc = buildCentresGeoJson(file);
    const young = file.centres.filter((c) => c.infant + c.toddler + c.preschool > 0);
    // school-age-only centres are not pins (the tool is for children under school age)
    expect(fc.features.length).toBe(young.length);
    expect(fc.features.length).toBeLessThan(file.centres.length);
    const first = fc.features[0];
    expect(first.geometry.coordinates).toEqual([young[0].lng, young[0].lat]);
    expect(Object.keys(first.properties).sort()).toEqual(["cwelcc", "id", "infant", "name", "preschool", "toddler"]);
  });
});
