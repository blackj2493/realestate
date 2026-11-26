import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildCentresGeoJson } from "./centresGeoJson";
import type { ChildCareFile } from "./torontoChildCare";
import type { OntarioChildCareFile } from "./ontarioChildCare";

const read = <T,>(name: string): T => JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", name), "utf-8")) as T;
const toronto = read<ChildCareFile>("toronto-child-care.json");
const ontario = read<OntarioChildCareFile>("ontario-child-care.json");

describe("buildCentresGeoJson", () => {
  it("emits one [lng, lat] point per Toronto centre with under-school-age spaces with the compact props", () => {
    const fc = buildCentresGeoJson(toronto);
    const young = toronto.centres.filter((c) => c.infant + c.toddler + c.preschool > 0);
    // school-age-only centres are not pins (the tool is for children under school age)
    expect(fc.features.length).toBe(young.length);
    expect(fc.features.length).toBeLessThan(toronto.centres.length);
    const first = fc.features[0];
    expect(first.geometry.coordinates).toEqual([young[0].lng, young[0].lat]);
    expect(Object.keys(first.properties).sort()).toEqual(["cwelcc", "detail", "id", "infant", "name", "preschool", "toddler"]);
    expect(first.properties.detail).toBe(true);
    expect(fc.ontarioUpdated).toBeNull();
  });

  it("adds every Ontario centre as a detail:false pin with fullDay", () => {
    const fc = buildCentresGeoJson(toronto, ontario);
    const prov = fc.features.filter((f) => !f.properties.detail);
    expect(prov.length).toBe(ontario.centres.length);
    expect(Object.keys(prov[0].properties).sort()).toEqual(["detail", "fullDay", "id", "name"]);
    expect(prov[0].geometry.coordinates).toEqual([ontario.centres[0].lng, ontario.centres[0].lat]);
    expect(fc.ontarioUpdated).toBe(ontario.updated);
    // Keep the one-shot payload reasonable: ~790 KB raw / ~110 KB gzip on 2026-11-25.
    expect(JSON.stringify(fc).length).toBeLessThan(1_000_000);
  });
});
