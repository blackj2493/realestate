import { describe, it, expect } from "vitest";
import { mapSearchBoxFeatures } from "./mapSearchBox";

const poi = (name: string, lng: number, lat: number, place = "Toronto, M5J 1E6, Canada") => ({
  geometry: { coordinates: [lng, lat] },
  properties: { name, place_formatted: place, feature_type: "poi", poi_category: ["train station"] },
});
/** A Mapbox POI with an EMPTY poi_category — the short-term-rental shape. */
const uncategorized = (name: string, lng: number, lat: number, place = "L1S 6R3, Canada") => ({
  geometry: { coordinates: [lng, lat] },
  properties: { name, place_formatted: place, feature_type: "poi", poi_category: [] },
});

describe("mapSearchBoxFeatures", () => {
  it("keeps a station POI and reads it as name + context", () => {
    // The reported bug: Geocoding v5 answered "union station" with Station Street and
    // Station Gate Road. Search Box answers with the station; this is what we show.
    const out = mapSearchBoxFeatures([poi("Union Station", -79.38068017, 43.64539768)]);
    expect(out).toEqual([
      { label: "Union Station · Toronto, M5J 1E6, Canada", lat: 43.64539768, lng: -79.38068017 },
    ]);
  });

  it("collapses the three Union Station records Mapbox really returns", () => {
    // Live response, verbatim: same name, three points inside ~80 m.
    const out = mapSearchBoxFeatures([
      poi("Union Station", -79.38068017, 43.64539768),
      poi("Union Station", -79.38072838, 43.64532899),
      poi("Union Station", -79.38037574565438, 43.644712963752696),
      poi("Union Station GO", -79.3805, 43.6452),
    ]);
    expect(out.map((r) => r.label)).toEqual([
      "Union Station · Toronto, M5J 1E6, Canada",
      "Union Station GO · Toronto, M5J 1E6, Canada",
    ]);
  });

  it("collapses a repeated name even when the coordinates differ", () => {
    const out = mapSearchBoxFeatures([
      poi("Oakville GO Bus", -79.68242334, 43.45557287, "L6J 2W6, Canada"),
      poi("Oakville GO Bus", -79.7, 43.5, "L6J 2W6, Canada"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps genuinely distinct POIs at the same query", () => {
    const out = mapSearchBoxFeatures([
      poi("Oakville GO", -79.68224794, 43.45552477, "Oakville, L6J 2W6, Canada"),
      poi("Oakville Golf Club", -79.7, 43.48, "Oakville, L6H 1S4, Canada"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("uses full_address for an address feature, with no separator styling", () => {
    const out = mapSearchBoxFeatures([
      {
        geometry: { coordinates: [-79.299717, 43.682804] },
        properties: {
          name: "123 Main Street",
          full_address: "123 Main Street, Toronto, Ontario M4E 1Z5, Canada",
          place_formatted: "Toronto, Ontario M4E 1Z5, Canada",
          feature_type: "address",
        },
      },
    ]);
    expect(out[0].label).toBe("123 Main Street, Toronto, Ontario M4E 1Z5, Canada");
  });

  it("drops features with no usable coordinate rather than emitting NaN", () => {
    expect(
      mapSearchBoxFeatures([
        { geometry: { coordinates: [] }, properties: { name: "Nowhere" } },
        { geometry: {}, properties: { name: "Nowhere 2" } },
        { properties: { name: "Nowhere 3" } },
        { geometry: { coordinates: ["x", "y"] }, properties: { name: "Nowhere 4" } },
      ])
    ).toEqual([]);
  });

  it("demotes uncategorized POIs below the real station — the Ajax GO case", () => {
    // Live "Ajax GO Station" response order, verbatim: two rental listings whose titles
    // name the station, then the street rows. Mapbox ranked the rentals first.
    const out = mapSearchBoxFeatures([
      uncategorized("Entire basement walkable to Ajax GO station - Suite", -79.03, 43.85),
      uncategorized("Ajax Beautiful Cozy Room- 10 mins to Go Station, Water Front Park, Plaza", -79.04, 43.86),
      poi("Ajax GO", -79.0271, 43.8503, "Ajax, L1S 7H3, Canada"),
    ]);
    expect(out[0].label).toBe("Ajax GO · Ajax, L1S 7H3, Canada");
    // Demoted, not dropped — an uncategorized POI is unranked, not proven junk.
    expect(out).toHaveLength(3);
  });

  it("never demotes on wording — a long real name keeps its place", () => {
    // The reason the rule reads poi_category and not the name: a keyword or length rule
    // would bury this one too.
    const out = mapSearchBoxFeatures([
      poi("Bramalea Church of God Prayer Centre", -79.72, 43.72, "Brampton, L6T 1Y4, Canada"),
      uncategorized("Cozy Room 10 mins to Bramalea GO", -79.73, 43.73),
    ]);
    expect(out[0].label).toBe("Bramalea Church of God Prayer Centre · Brampton, L6T 1Y4, Canada");
  });

  it("leaves streets and addresses alone — the rule is POI-only", () => {
    const street = {
      geometry: { coordinates: [-79.3, 43.68] },
      properties: { name: "Station Street", full_address: "Station Street, Ajax, Ontario", feature_type: "street" },
    };
    const out = mapSearchBoxFeatures([street, uncategorized("Entire basement near the GO", -79.31, 43.69)]);
    expect(out[0].label).toBe("Station Street, Ajax, Ontario");
  });

  it("returns [] for a non-array payload (a Mapbox error body, not a crash)", () => {
    expect(mapSearchBoxFeatures(undefined)).toEqual([]);
    expect(mapSearchBoxFeatures({ message: "Not Authorized" })).toEqual([]);
  });

  it("trims to the limit AFTER de-duplication, so duplicates can't eat the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => poi(`Place ${i}`, -79.3 - i / 100, 43.6 + i / 100));
    expect(mapSearchBoxFeatures(many)).toHaveLength(5);
  });
});
