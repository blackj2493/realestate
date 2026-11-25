import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildCentresGeoJson } from "./centresGeoJson";
import type { ChildCareFile } from "./torontoChildCare";

describe("buildCentresGeoJson", () => {
  it("emits one [lng, lat] point per centre with the compact props", () => {
    const file = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "toronto-child-care.json"), "utf-8")
    ) as ChildCareFile;
    const fc = buildCentresGeoJson(file);
    expect(fc.features.length).toBe(file.centres.length);
    const first = fc.features[0];
    expect(first.geometry.coordinates).toEqual([file.centres[0].lng, file.centres[0].lat]);
    expect(Object.keys(first.properties).sort()).toEqual(["cwelcc", "id", "infant", "name", "preschool", "toddler"]);
  });
});
